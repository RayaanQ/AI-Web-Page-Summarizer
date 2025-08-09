//Background Service Worker that Handles extension lifecycle and communication between components
//Background service worker for managing extension state

// Enhanced Background Service Worker for Chatbot
// Manages sessions, API communication, and extension lifecycle

class ChatbotBackgroundService {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.activeTabContent = new Map();
        this.activeSessions = new Map();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkApiHealth();
        this.setupPeriodicCleanup();
    }
    
    setupEventListeners() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstall(details);
        });
        
        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true;
        });
        
        // Handle tab updates
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });
        
        // Handle tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.activeTabContent.delete(tabId);
            // Clean up any sessions associated with this tab
            this.cleanupTabSessions(tabId);
        });
        
        // Handle browser action click
        chrome.action.onClicked.addListener((tab) => {
            this.handleActionClick(tab);
        });
    }
    
    // Enhanced install handler
    handleInstall(details) {
        console.log('AI Web Chatbot installed/updated:', details.reason);
        
        if (details.reason === 'install') {
            chrome.storage.sync.set({
                length: 'medium',
                chatHistory: true,
                followupQuestions: true,
                firstRun: true
            });
            
            // Open welcome page
            chrome.tabs.create({
                url: chrome.runtime.getURL('popup/popup.html')
            });
        }
    }
    
    // Enhanced message handler
    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'contentScriptReady':
                    this.handleContentScriptReady(request, sender);
                    sendResponse({ success: true });
                    break;
                    
                case 'extractContent':
                    const content = await this.extractContentFromTab(sender.tab.id);
                    sendResponse({ success: true, data: content });
                    break;
                    
                case 'checkApiHealth':
                    const health = await this.checkApiHealth();
                    sendResponse({ success: true, data: health });
                    break;
                    
                case 'summarize':
                    const summary = await this.summarizeContent(request.data);
                    sendResponse({ success: true, data: summary });
                    break;
                    
                case 'chat':
                    const chatResponse = await this.sendChatMessage(request.data);
                    sendResponse({ success: true, data: chatResponse });
                    break;
                    
                case 'getSession':
                    const sessionInfo = await this.getSessionInfo(request.sessionId);
                    sendResponse({ success: true, data: sessionInfo });
                    break;
                    
                case 'deleteSession':
                    const deleted = await this.deleteSession(request.sessionId);
                    sendResponse({ success: true, data: { deleted } });
                    break;
                    
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background message handling error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    
    // Content script ready handler
    handleContentScriptReady(request, sender) {
        if (sender.tab) {
            console.log(`Content script ready for tab ${sender.tab.id}: ${request.url}`);
        }
    }
    
    // Enhanced tab update handler
    handleTabUpdate(tabId, changeInfo, tab) {
        if (changeInfo.url) {
            this.activeTabContent.delete(tabId);
            this.cleanupTabSessions(tabId);
        }
        
        if (changeInfo.status === 'complete') {
            this.updateTabBadge(tabId, tab);
        }
    }
    
    // Clean up sessions for a specific tab
    cleanupTabSessions(tabId) {
        for (const [sessionId, sessionData] of this.activeSessions.entries()) {
            if (sessionData.tabId === tabId) {
                this.activeSessions.delete(sessionId);
            }
        }
    }
    
    // Action button click handler
    handleActionClick(tab) {
        console.log('Extension icon clicked for tab:', tab.id);
        // Popup should handle this, but we can add fallback behavior here
    }
    
    // Enhanced content extraction
    async extractContentFromTab(tabId) {
        try {
            if (this.activeTabContent.has(tabId)) {
                return this.activeTabContent.get(tabId);
            }
            
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    if (window.aiWebSummarizerExtractor) {
                        return window.aiWebSummarizerExtractor.extractStructuredContent();
                    }
                    throw new Error('Content extractor not available');
                }
            });
            
            if (results && results[0] && results[0].result) {
                const content = results[0].result;
                this.activeTabContent.set(tabId, content);
                return content;
            }
            
            throw new Error('Failed to extract content');
            
        } catch (error) {
            console.error('Content extraction error:', error);
            throw error;
        }
    }
    
    // Enhanced API health check
    async checkApiHealth() {
        try {
            const response = await fetch(`${this.apiUrl}/`, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (response.ok) {
                const data = await response.json();
                return {
                    available: true,
                    ...data
                };
            }
            
            return { available: false, error: `HTTP ${response.status}` };
            
        } catch (error) {
            return { 
                available: false, 
                error: error.message,
                suggestion: 'Make sure the FastAPI server is running on localhost:8000'
            };
        }
    }
    
    // Forward summarization request to enhanced API
    async summarizeContent(requestData) {
        try {
            const response = await fetch(`${this.apiUrl}/summarize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `API Error: ${response.status}`);
            }
            
            const result = await response.json();
            
            // Store session info locally for quick access
            if (result.session_id) {
                this.activeSessions.set(result.session_id, {
                    id: result.session_id,
                    createdAt: Date.now(),
                    tabId: null // We don't have tab ID here, but could be added
                });
            }
            
            return result;
            
        } catch (error) {
            console.error('Summarization API error:', error);
            throw error;
        }
    }
    
    // Send chat message to API
    async sendChatMessage(requestData) {
        try {
            const response = await fetch(`${this.apiUrl}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `Chat API Error: ${response.status}`);
            }
            
            return await response.json();
            
        } catch (error) {
            console.error('Chat API error:', error);
            throw error;
        }
    }
    
    // Get session information
    async getSessionInfo(sessionId) {
        try {
            const response = await fetch(`${this.apiUrl}/session/${sessionId}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `Session API Error: ${response.status}`);
            }
            
            return await response.json();
            
        } catch (error) {
            console.error('Session info API error:', error);
            throw error;
        }
    }
    
    // Delete session
    async deleteSession(sessionId) {
        try {
            const response = await fetch(`${this.apiUrl}/session/${sessionId}`, {
                method: 'DELETE'
            });
            
            if (response.ok) {
                this.activeSessions.delete(sessionId);
                return true;
            }
            
            return false;
            
        } catch (error) {
            console.error('Delete session error:', error);
            return false;
        }
    }
    
    // Enhanced badge management
    async updateTabBadge(tabId, tab) {
        try {
            if (!tab.url || tab.url.startsWith('chrome://')) {
                chrome.action.setBadgeText({ text: '', tabId });
                return;
            }
            
            const hasContent = this.activeTabContent.has(tabId);
            const sessionCount = Array.from(this.activeSessions.values())
                .filter(session => session.tabId === tabId).length;
            
            if (sessionCount > 0) {
                chrome.action.setBadgeText({ text: `${sessionCount}`, tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId });
            } else if (hasContent) {
                chrome.action.setBadgeText({ text: '●', tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#667eea', tabId });
            } else {
                chrome.action.setBadgeText({ text: '', tabId });
            }
            
        } catch (error) {
            console.log('Badge update error:', error);
        }
    }
    
    // Setup periodic cleanup of old sessions
    setupPeriodicCleanup() {
        setInterval(() => {
            this.cleanupOldSessions();
        }, 300000); // Clean up every 5 minutes
    }
    
    // Clean up old local session references
    cleanupOldSessions() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        for (const [sessionId, sessionData] of this.activeSessions.entries()) {
            if (now - sessionData.createdAt > maxAge) {
                this.activeSessions.delete(sessionId);
            }
        }
    }
}

// Initialize enhanced background service
const backgroundService = new ChatbotBackgroundService();

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
    console.log('Port connected:', port.name);
});