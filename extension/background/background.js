//Background Service Worker that Handles extension lifecycle and communication between components
//Background service worker for managing extension state

class BackgroundService {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.activeTabContent = new Map();
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.checkApiHealth();
    }
    
    //Set up event listeners for various Chrome extension events
    setupEventListeners() {
        // Handle extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstall(details);
        });
        
        // Handle messages from content scripts and popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });
        
        // Handle tab updates
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });
        
        // Handle tab removal
        chrome.tabs.onRemoved.addListener((tabId) => {
            this.activeTabContent.delete(tabId);
        });
        
        // Handle browser action click (if popup fails to load)
        chrome.action.onClicked.addListener((tab) => {
            this.handleActionClick(tab);
        });
    }
    
    //Handle extension installation and updates
    handleInstall(details) {
        console.log('AI Web Summarizer installed/updated:', details.reason);
        
        if (details.reason === 'install') {
            // Set default settings
            chrome.storage.sync.set({
                provider: 'Google Gemini',
                length: 'medium',
                firstRun: true
            });
            
            // Open welcome page
            chrome.tabs.create({
                url: chrome.runtime.getURL('popup/popup.html')
            });
        }
    }
    
    //Handle messages from content scripts and popup

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
                    
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background message handling error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }
    
    //Handle content script ready notification
    
    handleContentScriptReady(request, sender) {
        if (sender.tab) {
            console.log(`Content script ready for tab ${sender.tab.id}: ${request.url}`);
        }
    }
    
    //Handle tab updates

    handleTabUpdate(tabId, changeInfo, tab) {
        // Clear cached content when page changes
        if (changeInfo.url) {
            this.activeTabContent.delete(tabId);
        }
        
        // Update badge text based on content availability
        if (changeInfo.status === 'complete') {
            this.updateTabBadge(tabId, tab);
        }
    }
    
    //Handle action button click (fallback)
    handleActionClick(tab) {
        console.log('Extension icon clicked for tab:', tab.id);
        // This is a fallback - normally the popup should handle this
    }
    
    //Extract content from specified tab
    async extractContentFromTab(tabId) {
        try {
            // Check if we have cached content
            if (this.activeTabContent.has(tabId)) {
                return this.activeTabContent.get(tabId);
            }
            
            // Execute content extraction script
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                func: () => {
                    if (window.aiWebSummarizerExtractor) {
                        return window.aiWebSummarizerExtractor.extractPageContent();
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
    
    //Check API server health
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
    
    //Update tab badge to show status
    async updateTabBadge(tabId, tab) {
        try {
            if (!tab.url || tab.url.startsWith('chrome://')) {
                chrome.action.setBadgeText({ text: '', tabId });
                return;
            }
            
            // Check if content is available
            const hasContent = this.activeTabContent.has(tabId);
            
            if (hasContent) {
                chrome.action.setBadgeText({ text: '✓', tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId });
            } else {
                chrome.action.setBadgeText({ text: '', tabId });
            }
            
        } catch (error) {
            // Ignore badge errors
            console.log('Badge update error:', error);
        }
    }
    
    //Forward summarization request to API
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
            
            return await response.json();
            
        } catch (error) {
            console.error('Summarization API error:', error);
            throw error;
        }
    }
}

// Initialize background service
const backgroundService = new BackgroundService();

// Keep service worker alive
chrome.runtime.onConnect.addListener((port) => {
    console.log('Port connected:', port.name);
});