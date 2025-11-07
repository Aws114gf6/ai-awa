import { useState, useEffect, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { Loader2, MessageSquare, Plus, Send, Trash2, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import * as webllm from "@mlc-ai/web-llm";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const engineRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize WebLLM
  useEffect(() => {
    loadConversations();
    // تحميل النموذج في الخلفية
    setTimeout(() => {
      initializeModel();
    }, 1000);
  }, []);

  const initializeModel = async () => {
    try {
      setModelLoading(true);
      setLoadingProgress("جاري تحميل نموذج الذكاء الاصطناعي المحلي...");

      const engine = await webllm.CreateMLCEngine(
        "Phi-3.5-mini-instruct-q4f16_1-MLC",
        {
          initProgressCallback: (progress) => {
            setLoadingProgress(progress.text || "جاري التحميل...");
          },
        }
      );

      engineRef.current = engine;
      setModelReady(true);
      setModelLoading(false);
      toast.success("النموذج جاهز الآن! يمكنك بدء المحادثة");
    } catch (error) {
      console.error("Error initializing model:", error);
      toast.error("فشل تحميل النموذج. ستتمكن من حفظ الرسائل فقط.");
      setModelLoading(false);
    }
  };

  const loadConversations = async () => {
    try {
      const response = await axios.get(`${API}/conversations`);
      setConversations(response.data);
    } catch (error) {
      console.error("Error loading conversations:", error);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await axios.post(`${API}/conversations`, {
        title: `محادثة جديدة ${conversations.length + 1}`,
      });
      const newConv = response.data;
      setConversations([newConv, ...conversations]);
      setCurrentConversation(newConv);
      setMessages([]);
      setSidebarOpen(false); // إغلاق الـ sidebar على الهواتف
      toast.success("تم إنشاء محادثة جديدة");
    } catch (error) {
      console.error("Error creating conversation:", error);
      toast.error("فشل إنشاء محادثة جديدة");
    }
  };

  const selectConversation = async (conv) => {
    setCurrentConversation(conv);
    setMessages(conv.messages || []);
    setSidebarOpen(false); // إغلاق الـ sidebar على الهواتف
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/conversations/${convId}`);
      setConversations(conversations.filter((c) => c.id !== convId));
      if (currentConversation?.id === convId) {
        setCurrentConversation(null);
        setMessages([]);
      }
      toast.success("تم حذف المحادثة");
    } catch (error) {
      console.error("Error deleting conversation:", error);
      toast.error("فشل حذف المحادثة");
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || !currentConversation) {
      if (!currentConversation) {
        toast.error("يرجى إنشاء محادثة جديدة أولاً");
      }
      return;
    }

    const userMessage = inputMessage.trim();
    setInputMessage("");
    setIsLoading(true);

    try {
      // Save user message
      const userMsgResponse = await axios.post(
        `${API}/conversations/${currentConversation.id}/messages`,
        {
          role: "user",
          content: userMessage,
        }
      );

      const newUserMsg = userMsgResponse.data;
      setMessages((prev) => [...prev, newUserMsg]);

      // Generate AI response only if model is ready
      if (modelReady && engineRef.current) {
        const chatHistory = [...messages, newUserMsg].map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        const reply = await engineRef.current.chat.completions.create({
          messages: chatHistory,
          temperature: 0.7,
          max_tokens: 512,
        });

        const aiResponse = reply.choices[0].message.content;

        // Save AI message
        const aiMsgResponse = await axios.post(
          `${API}/conversations/${currentConversation.id}/messages`,
          {
            role: "assistant",
            content: aiResponse,
          }
        );

        const newAiMsg = aiMsgResponse.data;
        setMessages((prev) => [...prev, newAiMsg]);
      } else {
        toast.info("النموذج ما زال يحمّل. رسالتك تم حفظها.");
      }

      // Update conversation list
      loadConversations();
    } catch (error) {
      console.error("Error sending message:", error);
      toast.error("فشل إرسال الرسالة");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="app-container" data-testid="app-container">
      {/* Overlay للهواتف */}
      {sidebarOpen && (
        <div 
          className="sidebar-overlay" 
          onClick={() => setSidebarOpen(false)}
          data-testid="sidebar-overlay"
        ></div>
      )}

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`} data-testid="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-top">
            <h2>المحادثات</h2>
            <Button
              variant="ghost"
              size="sm"
              className="close-sidebar-btn"
              onClick={() => setSidebarOpen(false)}
              data-testid="close-sidebar-btn"
            >
              <X className="icon" />
            </Button>
          </div>
          <Button
            onClick={createNewConversation}
            className="new-chat-btn"
            size="sm"
            data-testid="new-conversation-btn"
          >
            <Plus className="icon" />
            محادثة جديدة
          </Button>
        </div>

        <ScrollArea className="conversations-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                currentConversation?.id === conv.id ? "active" : ""
              }`}
              onClick={() => selectConversation(conv)}
              data-testid={`conversation-item-${conv.id}`}
            >
              <MessageSquare className="conv-icon" />
              <span className="conv-title">{conv.title}</span>
              <Button
                variant="ghost"
                size="sm"
                className="delete-btn"
                onClick={(e) => deleteConversation(conv.id, e)}
                data-testid={`delete-conversation-${conv.id}`}
              >
                <Trash2 className="icon" />
              </Button>
            </div>
          ))}
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="chat-container" data-testid="chat-container">
        {modelLoading ? (
          <div className="loading-screen" data-testid="model-loading">
            <div className="loading-content">
              <Loader2 className="spinner" />
              <h2>تحميل نموذج الذكاء الاصطناعي المحلي</h2>
              <p>{loadingProgress}</p>
              <p className="loading-note">
                قد يستغرق التحميل الأول بضع دقائق. النموذج يعمل بالكامل على جهازك.
              </p>
            </div>
          </div>
        ) : !currentConversation ? (
          <div className="empty-state" data-testid="empty-state">
            <Button
              variant="ghost"
              className="menu-toggle-btn"
              onClick={() => setSidebarOpen(true)}
              data-testid="menu-toggle-btn"
            >
              <Menu className="icon" />
            </Button>
            <div className="empty-content">
              <MessageSquare className="empty-icon" />
              <h2>مرحباً بك في تطبيق المحادثة المحلي</h2>
              <p>ابدأ محادثة جديدة للتحدث مع الذكاء الاصطناعي المحلي</p>
              <Button onClick={createNewConversation} className="start-btn" data-testid="start-conversation-btn">
                <Plus className="icon" />
                ابدأ محادثة جديدة
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="chat-header" data-testid="chat-header">
              <div className="chat-header-right">
                <Button
                  variant="ghost"
                  size="sm"
                  className="menu-btn"
                  onClick={() => setSidebarOpen(true)}
                  data-testid="open-sidebar-btn"
                >
                  <Menu className="icon" />
                </Button>
                <h3>{currentConversation.title}</h3>
              </div>
              <div className="model-status">
                <div className="status-dot"></div>
                <span>Phi-3.5 Mini (محلي)</span>
              </div>
            </div>

            <ScrollArea className="messages-area">
              <div className="messages-container" data-testid="messages-container">
                {messages.map((msg, index) => (
                  <div
                    key={msg.id || index}
                    className={`message ${msg.role}`}
                    data-testid={`message-${msg.role}-${index}`}
                  >
                    <div className="message-content">{msg.content}</div>
                  </div>
                ))}
                {isLoading && (
                  <div className="message assistant" data-testid="loading-message">
                    <div className="message-content">
                      <Loader2 className="spinner-small" />
                      جاري التفكير...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="input-area" data-testid="input-area">
              <div className="input-wrapper">
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={modelReady ? "اكتب رسالتك هنا..." : "اكتب رسالتك (النموذج يحمّل...)"}
                  disabled={isLoading}
                  className="message-input"
                  data-testid="message-input"
                />
                <Button
                  onClick={sendMessage}
                  disabled={isLoading || !inputMessage.trim()}
                  className="send-btn"
                  data-testid="send-message-btn"
                >
                  <Send className="icon" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;