// src/hooks/useChat.js
import { useState, useCallback } from 'react';
import { createNewChat, addMessageToChat } from '../firebase';
import { fetchDocuments, fetchAnalysis } from '../utils/api';

const createMessageId = (type) => `${Date.now()}-${type}-${Math.random().toString(36).substr(2, 9)}`;

const WELCOME_MESSAGE = "Hello! Go ahead and search clinical research material of interest.";

const useChat = (user, selectedTemplate) => {
  const [chatHistory, setChatHistory] = useState([
    { id: 'welcome', text: WELCOME_MESSAGE, isUser: false },
  ]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [activeChat, setActiveChat] = useState(null);
  const [message, setMessage] = useState('');

  const initializeNewChat = useCallback(async (chatId = null) => {
    // If chatId is provided, use it; otherwise create a new chat
    try {
      let currentChatId = chatId;
      if (!currentChatId) {
        const initialMessages = [{
          content: WELCOME_MESSAGE,
          role: 'assistant',
          timestamp: new Date(),
          type: 'message',
          messageId: `welcome-${Date.now()}`
        }];
        
        currentChatId = await createNewChat(user.uid, initialMessages);
      }

      setActiveChat({
        id: currentChatId,
        messages: [{
          content: WELCOME_MESSAGE,
          role: 'assistant',
          timestamp: new Date(),
          type: 'message',
          messageId: `welcome-${Date.now()}`
        }],
        createdAt: new Date()
      });

      setChatHistory([{
        id: `welcome-${currentChatId}`,
        text: WELCOME_MESSAGE,
        isUser: false
      }]);

      return currentChatId;
    } catch (error) {
      console.error('Error initializing new chat:', error);
      throw error;
    }
  }, [user]);

  const handleChatSelect = useCallback(async (chat) => {
    if (chat) {
      setActiveChat(chat);
      
      const messages = [];
      
      chat.messages?.forEach(msg => {
        if (msg.type === 'message') {
          messages.push({
            id: msg.messageId,
            text: msg.content,
            isUser: msg.role === 'user',
            timestamp: msg.timestamp
          });
        } else if (msg.type === 'documents') {
          messages.push({
            id: msg.messageId,
            text: "I've retrieved some relevant documents. Analyzing them now...",
            isUser: false,
            documents: JSON.parse(msg.content),
            timestamp: msg.timestamp
          });
        } else if (msg.type === 'analysis') {
          messages.push({
            id: msg.messageId,
            text: "I've completed the analysis. You can view the results below.",
            isUser: false,
            analysis: msg.content,
            timestamp: msg.timestamp
          });
        }
      });

      if (!messages.find(msg => msg.text === WELCOME_MESSAGE)) {
        messages.unshift({ 
          id: `welcome-${chat.id}`, 
          text: WELCOME_MESSAGE, 
          isUser: false 
        });
      }

      setChatHistory(messages);
    } else {
      // This now calls initializeNewChat instead of just resetting state
      await initializeNewChat();
    }
  }, [initializeNewChat]);

  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault();
    if (message.trim() && !isLoadingDocs && !isLoadingAnalysis && user) {
      const userMessage = message;
      setMessage('');

      const newUserMessage = { 
        id: createMessageId('user'), 
        text: userMessage, 
        isUser: true,
        timestamp: new Date()
      };
      
      try {
        let currentChatId = activeChat?.id;
        let messagesForFirestore = [];
        
        if (!currentChatId) {
          currentChatId = await initializeNewChat();
        }

        messagesForFirestore = [...(activeChat?.messages || [])];
        messagesForFirestore.push({
          content: userMessage,
          role: 'user',
          timestamp: new Date(),
          type: 'message',
          messageId: newUserMessage.id
        });
        
        setChatHistory(prev => [...prev, newUserMessage]);
        await addMessageToChat(user.uid, currentChatId, messagesForFirestore);

        setIsLoadingDocs(true);
        try {
          const docs = await fetchDocuments(userMessage);
          setIsLoadingDocs(false);
          
          const docsMessage = { 
            id: createMessageId('assistant-docs'), 
            text: "I've retrieved some relevant documents. Analyzing them now...", 
            isUser: false,
            documents: docs,
            timestamp: new Date()
          };

          messagesForFirestore.push({
            content: JSON.stringify(docs),
            role: 'assistant',
            timestamp: new Date(),
            type: 'documents',
            messageId: docsMessage.id
          });

          setChatHistory(prev => [...prev, docsMessage]);
          await addMessageToChat(user.uid, currentChatId, messagesForFirestore);

          setIsLoadingAnalysis(true);
          try {
            const analysisResult = await fetchAnalysis(userMessage, selectedTemplate?.content);
            
            const analysisMessage = { 
              id: createMessageId('analysis'), 
              text: "I've completed the analysis. You can view the results below.", 
              isUser: false,
              analysis: analysisResult,
              timestamp: new Date()
            };
            
            messagesForFirestore.push({
              content: analysisResult,
              role: 'assistant',
              timestamp: new Date(),
              type: 'analysis',
              messageId: analysisMessage.id
            });
            
            setChatHistory(prev => [...prev, analysisMessage]);
            await addMessageToChat(user.uid, currentChatId, messagesForFirestore);
            
          } catch (error) {
            console.error('Error fetching analysis:', error);
            const errorMessage = {
              id: createMessageId('error'),
              text: "I'm sorry, there was an error generating the analysis. Please try again.",
              isUser: false,
              timestamp: new Date()
            };
            
            messagesForFirestore.push({
              content: errorMessage.text,
              role: 'assistant',
              timestamp: new Date(),
              type: 'error',
              messageId: errorMessage.id
            });
            
            setChatHistory(prev => [...prev, errorMessage]);
            await addMessageToChat(user.uid, currentChatId, messagesForFirestore);
          }
          setIsLoadingAnalysis(false);
        } catch (error) {
          console.error('Error fetching documents:', error);
          const errorMessage = {
            id: createMessageId('error'),
            text: "I'm sorry, there was an error retrieving documents. Please try again.",
            isUser: false,
            timestamp: new Date()
          };
          
          messagesForFirestore.push({
            content: errorMessage.text,
            role: 'assistant',
            timestamp: new Date(),
            type: 'error',
            messageId: errorMessage.id
          });
          
          setIsLoadingDocs(false);
          setChatHistory(prev => [...prev, errorMessage]);
          await addMessageToChat(user.uid, currentChatId, messagesForFirestore);
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    }
  }, [message, isLoadingDocs, isLoadingAnalysis, activeChat, user, selectedTemplate, initializeNewChat]);

  return {
    chatHistory,
    isLoadingDocs,
    isLoadingAnalysis,
    activeChat,
    message,
    setMessage,
    handleChatSelect,
    handleSendMessage,
    initializeNewChat  // Expose this so Sidebar can use it
  };
};

export default useChat;