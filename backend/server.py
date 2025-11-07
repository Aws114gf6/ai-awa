from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # 'user' or 'assistant'
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class Conversation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    messages: List[Message] = []
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ConversationCreate(BaseModel):
    title: str

class MessageCreate(BaseModel):
    role: str
    content: str

class ConversationUpdate(BaseModel):
    title: Optional[str] = None


# Routes
@api_router.get("/")
async def root():
    return {"message": "Local AI Chat API"}

# Conversation endpoints
@api_router.post("/conversations", response_model=Conversation)
async def create_conversation(input: ConversationCreate):
    conversation = Conversation(title=input.title)
    doc = conversation.model_dump()
    doc['created_at'] = doc['created_at'].isoformat()
    doc['updated_at'] = doc['updated_at'].isoformat()
    
    await db.conversations.insert_one(doc)
    return conversation

@api_router.get("/conversations", response_model=List[Conversation])
async def get_conversations():
    conversations = await db.conversations.find({}, {"_id": 0}).to_list(1000)
    
    for conv in conversations:
        if isinstance(conv['created_at'], str):
            conv['created_at'] = datetime.fromisoformat(conv['created_at'])
        if isinstance(conv['updated_at'], str):
            conv['updated_at'] = datetime.fromisoformat(conv['updated_at'])
        
        # Convert message timestamps
        for msg in conv.get('messages', []):
            if isinstance(msg.get('timestamp'), str):
                msg['timestamp'] = datetime.fromisoformat(msg['timestamp'])
    
    # Sort by updated_at descending
    conversations.sort(key=lambda x: x['updated_at'], reverse=True)
    return conversations

@api_router.get("/conversations/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    conversation = await db.conversations.find_one({"id": conversation_id}, {"_id": 0})
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if isinstance(conversation['created_at'], str):
        conversation['created_at'] = datetime.fromisoformat(conversation['created_at'])
    if isinstance(conversation['updated_at'], str):
        conversation['updated_at'] = datetime.fromisoformat(conversation['updated_at'])
    
    # Convert message timestamps
    for msg in conversation.get('messages', []):
        if isinstance(msg.get('timestamp'), str):
            msg['timestamp'] = datetime.fromisoformat(msg['timestamp'])
    
    return conversation

@api_router.put("/conversations/{conversation_id}", response_model=Conversation)
async def update_conversation(conversation_id: str, input: ConversationUpdate):
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    
    if input.title is not None:
        update_data["title"] = input.title
    
    result = await db.conversations.update_one(
        {"id": conversation_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return await get_conversation(conversation_id)

@api_router.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    result = await db.conversations.delete_one({"id": conversation_id})
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {"message": "Conversation deleted"}

# Message endpoints
@api_router.post("/conversations/{conversation_id}/messages", response_model=Message)
async def add_message(conversation_id: str, input: MessageCreate):
    conversation = await db.conversations.find_one({"id": conversation_id})
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    message = Message(role=input.role, content=input.content)
    message_dict = message.model_dump()
    message_dict['timestamp'] = message_dict['timestamp'].isoformat()
    
    await db.conversations.update_one(
        {"id": conversation_id},
        {
            "$push": {"messages": message_dict},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}
        }
    )
    
    return message


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()