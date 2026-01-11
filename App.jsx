import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, ImagePlus, AlertCircle, Loader, ChevronDown } from 'lucide-react';

// ============================================================================
// API SERVICE
// ============================================================================
const API_BASE_URL = 'https://chatapi.easepesa.com/api';
const TOKEN_KEY = 'chat_authorization';

class ChatAPI {
  constructor() {
    this.token = localStorage.getItem(TOKEN_KEY) || '';
    this.apiKey = '';
  }

  setApiKey(key) {
    this.apiKey = key;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem(TOKEN_KEY, token);
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': this.token,
      'api-key': this.apiKey,
      ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.code !== 200) {
      throw new Error(data.msg || 'Request failed');
    }

    return data.data;
  }

  async login(phone, tempToken) {
    const headers = { 'Authorization': tempToken };
    return this.request('/user/login', {
      method: 'POST',
      body: JSON.stringify({ phone }),
      headers,
    });
  }

  async getChatHistory(isGreeting = false) {
    return this.request(`/chat/chat-record?is_greeting=${isGreeting}`);
  }

  async getKeywords() {
    return this.request('/chat/chat-model');
  }

  async sendMessage(content, imageUrl = '') {
    return this.request('/chat/send-chat', {
      method: 'POST',
      body: JSON.stringify({ content, image_url: imageUrl }),
    });
  }

  async markAsRead(id) {
    return this.request('/chat/chat-read', {
      method: 'POST',
      body: JSON.stringify({ id }),
    });
  }

  async getOSSSignature(suffix) {
    return this.request(`/oss/oss-sign-new?suffix=${suffix}`);
  }

  async uploadToOSS(uploadUrl, file, credentials) {
    const formData = new FormData();
    formData.append('key', credentials.key);
    formData.append('OSSAccessKeyId', credentials.access_key_id);
    formData.append('policy', credentials.policy);
    formData.append('Signature', credentials.signature);
    formData.append('file', file);

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }
  }
}

const api = new ChatAPI();

// ============================================================================
// COMPONENTS
// ============================================================================

const Toast = ({ message, show, onClose }) => {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(onClose, 2500);
      return () => clearTimeout(timer);
    }
  }, [show, onClose]);

  if (!show) return null;

  return (
    <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
      {message}
    </div>
  );
};

const Message = ({ message, onVisible }) => {
  const ref = useRef(null);

  useEffect(() => {
    if (!message.is_view && ref.current) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            onVisible?.(message.id);
            observer.disconnect();
          }
        },
        { threshold: 0.5 }
      );

      observer.observe(ref.current);
      return () => observer.disconnect();
    }
  }, [message.is_view, message.id, onVisible]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });
  };

  const isUser = !message.is_reply;
  const status = message.msgStatus;

  return (
    <div
      ref={ref}
      className={`flex gap-2 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {message.title && (
          <div className="font-semibold text-sm mb-1 px-2">{message.title}</div>
        )}
        
        <div className={`relative px-4 py-2 rounded-2xl ${
          isUser 
            ? 'bg-green-100 rounded-br-none' 
            : 'bg-white rounded-bl-none shadow-sm'
        }`}>
          {message.image_url ? (
            <img 
              src={message.image_url} 
              alt="Uploaded" 
              className="max-w-xs rounded-lg"
            />
          ) : (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          )}
          
          <span className="text-xs text-gray-500 mt-1 block">
            {formatTime(message.create_time)}
          </span>
        </div>
      </div>

      {status !== undefined && (
        <div className="flex items-end pb-2">
          {status === 1 ? (
            <Loader className="w-4 h-4 text-gray-400 animate-spin" />
          ) : status === 2 ? (
            <AlertCircle className="w-4 h-4 text-red-500" />
          ) : null}
        </div>
      )}
    </div>
  );
};

const KeywordChips = ({ keywords, onSelect }) => {
  if (!keywords.length) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 hide-scrollbar">
      {keywords.map((keyword, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(keyword)}
          className="px-4 py-2 bg-white/60 backdrop-blur-sm rounded-full text-sm whitespace-nowrap hover:bg-white/80 transition-colors flex-shrink-0"
        >
          {keyword}
        </button>
      ))}
    </div>
  );
};

const ChatApp = ({ apiKey, phone, tempToken }) => {
  const [messages, setMessages] = useState([]);
  const [greetings, setGreetings] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '' });
  const [unreadCount, setUnreadCount] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const lastUnreadIdRef = useRef(0);

  useEffect(() => {
    api.setApiKey(apiKey);
    
    const init = async () => {
      try {
        const loginData = await api.login(phone, tempToken);
        api.setToken(loginData.token);

        const keywordData = await api.getKeywords();
        if (keywordData?.length) {
          const allKeywords = keywordData.reduce((acc, model) => {
            return [...acc, ...model.key_world.split('\n')];
          }, []);
          setKeywords(allKeywords);
        }

        await loadMessages(true);
      } catch (error) {
        showToast(error.message);
      } finally {
        setLoading(false);
      }
    };

    init();

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [apiKey, phone, tempToken]);

  useEffect(() => {
    if (!loading && !pollingIntervalRef.current) {
      pollingIntervalRef.current = setInterval(() => {
        loadMessages(false);
      }, 3000);
    }
  }, [loading]);

  const showToast = (message) => {
    setToast({ show: true, message });
  };

  const loadMessages = async (isInitial) => {
    try {
      const data = await api.getChatHistory(!isFirstLoad);
      
      if (Array.isArray(data)) {
        processMessages(data);
      } else {
        const { greeting = [], list = [] } = data;
        if (greeting.length && isInitial) {
          setGreetings(greeting.map(g => ({ ...g, is_reply: true, is_view: true })));
        }
        processMessages(list);
      }

      if (isInitial) {
        setIsFirstLoad(false);
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const processMessages = (msgs) => {
    const processed = [];
    let unread = 0;
    let lastUnread = 0;

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      processed.unshift(msg);
      
      if (!msg.is_view) {
        unread++;
        if (i === 0 && !msg.is_reply) {
          lastUnread = msg.id;
        }
      }
    }

    lastUnreadIdRef.current = lastUnread;
    setMessages(processed);
    setUnreadCount(unread);

    if (isFirstLoad && unread === 0) {
      scrollToBottom('auto');
    }
  };

  const scrollToBottom = (behavior = 'smooth') => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }, 100);
  };

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
    
    setShowScrollButton(distanceFromBottom > 80);
    
    if (distanceFromBottom < 80 && lastUnreadIdRef.current) {
      markAsRead(lastUnreadIdRef.current);
    }
  }, []);

  const markAsRead = async (id) => {
    if (!id) return;
    
    try {
      await api.markAsRead(id);
      setUnreadCount(0);
      lastUnreadIdRef.current = 0;
    } catch (error) {
      console.error('Failed to mark as read:', error);
    }
  };

  const handleSendMessage = async (content, imageUrl = '') => {
    if (!content.trim() && !imageUrl) return;

    const tempMessage = {
      id: Date.now(),
      content: content.trim(),
      image_url: imageUrl,
      is_reply: false,
      is_view: true,
      create_time: Date.now() / 1000,
      msgStatus: 1,
    };

    setMessages(prev => [...prev, tempMessage]);
    setInputValue('');
    setSending(true);
    scrollToBottom();

    try {
      await api.sendMessage(content.trim(), imageUrl);
      setMessages(prev => 
        prev.map(m => m.id === tempMessage.id ? { ...m, msgStatus: undefined } : m)
      );
    } catch (error) {
      setMessages(prev => 
        prev.map(m => m.id === tempMessage.id ? { ...m, msgStatus: 2 } : m)
      );
      showToast(error.message);
    } finally {
      setSending(false);
    }
  };

  const handleImageUpload = async (file) => {
    if (!file) return;

    const MAX_SIZE = 2 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      showToast('Image size must be less than 2MB');
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    const tempMessage = {
      id: Date.now(),
      content: '',
      image_url: previewUrl,
      is_reply: false,
      is_view: true,
      create_time: Date.now() / 1000,
      msgStatus: 1,
    };

    setMessages(prev => [...prev, tempMessage]);
    scrollToBottom();

    try {
      const ext = file.name.match(/\.[^.]+$/)?.[0] || '';
      const { upload_url, url, ...credentials } = await api.getOSSSignature(ext);
      
      await api.uploadToOSS(upload_url, file, credentials);
      
      setMessages(prev => 
        prev.map(m => m.id === tempMessage.id ? { ...m, image_url: url, msgStatus: undefined } : m)
      );

      await handleSendMessage('', url);
    } catch (error) {
      setMessages(prev => 
        prev.map(m => m.id === tempMessage.id ? { ...m, msgStatus: 2 } : m)
      );
      showToast(error.message);
    } finally {
      URL.revokeObjectURL(previewUrl);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(inputValue);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-b from-green-100 to-blue-100">
        <Loader className="w-10 h-10 animate-spin text-green-500" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-b from-green-100 to-blue-100">
      <div 
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-6"
      >
        {greetings.map((msg, idx) => (
          <Message key={`greeting-${idx}`} message={msg} />
        ))}

        {messages.map((msg, idx) => (
          <Message 
            key={msg.id || idx} 
            message={msg}
            onVisible={markAsRead}
          />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {showScrollButton && (
        <button
          onClick={() => scrollToBottom('smooth')}
          className="fixed bottom-32 right-6 bg-white rounded-full p-3 shadow-lg hover:shadow-xl transition-shadow z-10"
        >
          {unreadCount > 0 && (
            <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-semibold">
              {unreadCount}
            </span>
          )}
          <ChevronDown className="w-5 h-5 text-gray-600" />
        </button>
      )}

      <div className="bg-blue-100/80 backdrop-blur-sm border-t border-blue-200">
        <div className="px-4 py-3">
          <KeywordChips 
            keywords={keywords} 
            onSelect={(keyword) => setInputValue(keyword)}
          />
        </div>

        <div className="px-4 pb-4 flex gap-2 items-end">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-3 hover:bg-white/50 rounded-lg transition-colors"
            disabled={sending}
          >
            <ImagePlus className="w-5 h-5 text-gray-600" />
          </button>

          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Send your questions..."
            rows={1}
            className="flex-1 px-4 py-3 rounded-2xl border-none focus:outline-none focus:ring-2 focus:ring-green-400 resize-none"
            style={{ maxHeight: '120px' }}
          />

          <button
            onClick={() => handleSendMessage(inputValue)}
            disabled={!inputValue.trim() || sending}
            className={`p-3 rounded-lg transition-colors ${
              inputValue.trim() && !sending
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-gray-200 text-gray-400'
            }`}
          >
            <Send className="w-5 h-5" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => handleImageUpload(e.target.files?.[0])}
            className="hidden"
          />
        </div>
      </div>

      <Toast 
        message={toast.message} 
        show={toast.show}
        onClose={() => setToast({ show: false, message: '' })}
      />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
};

export default function App() {
  const [config, setConfig] = useState({
    apiKey: 'demo-api-key',
    phone: '1234567890',
    tempToken: 'demo-token',
    isConfigured: false
  });

  const handleStart = () => {
    if (config.apiKey && config.phone && config.tempToken) {
      setConfig(prev => ({ ...prev, isConfigured: true }));
    }
  };

  if (!config.isConfigured) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-b from-green-100 to-blue-100 p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">Chat Configuration</h1>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                API Key
              </label>
              <input
                type="text"
                value={config.apiKey}
                onChange={(e) => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                placeholder="Enter your API key"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                value={config.phone}
                onChange={(e) => setConfig(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="Enter phone number"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Temporary Token
              </label>
              <input
                type="text"
                value={config.tempToken}
                onChange={(e) => setConfig(prev => ({ ...prev, tempToken: e.target.value }))}
                placeholder="Enter temporary token"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-400 focus:border-transparent outline-none"
              />
            </div>
            <button
              onClick={handleStart}
              className="w-full bg-green-500 hover:bg-green-600 text-white font-medium py-3 rounded-lg transition-colors"
            >
              Start Chat
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ChatApp
      apiKey={config.apiKey}
      phone={config.phone}
      tempToken={config.tempToken}
    />
  );
}
