// Content extraction function (injected into page)
function extractContentFromPage() {
    function cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();
    }

    function getMainContent() {
        const elementsToRemove = [
            'script', 'style', 'nav', 'header', 'footer', 
            'aside', 'form', '.advertisement', '.ads',
            '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
        ];
        const contentSelectors = [
            'article', 'main', '[role="main"]', '.content',
            '.post-content', '.entry-content', '.article-content'
        ];
        
        for (const selector of contentSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const clone = element.cloneNode(true);
                elementsToRemove.forEach(sel => {
                    clone.querySelectorAll(sel).forEach(el => el.remove());
                });
                const text = clone.innerText || clone.textContent || '';
                if (text.length > 200) {
                    return cleanText(text);
                }
            }
        }
        
        const bodyClone = document.body.cloneNode(true);
        elementsToRemove.forEach(sel => {
            bodyClone.querySelectorAll(sel).forEach(el => el.remove());
        });
        return cleanText(bodyClone.innerText || bodyClone.textContent || '');
    }

    const title = document.title || 'Untitled Page';
    const url = window.location.href;
    const content = getMainContent();
    const metaDescription = document.querySelector('meta[name="description"]');
    const description = metaDescription ? metaDescription.getAttribute('content') : '';

    return {
        title,
        url,
        content,
        description,
        wordCount: content.split(/\s+/).length,
        timestamp: new Date().toISOString()
    };
}

class WebSummarizerChatbot {
    constructor() {
        this.apiUrl = 'http://localhost:8000';
        this.elements = {};
        this.currentPageData = null;
        this.currentSession = null;
        this.isLoading = false;
        
        this.init();
    }
    
    init() {
        this.bindElements();
        this.attachEventListeners();
        this.loadSettings();
        this.extractPageContent();
    }
    
    bindElements() {
        this.elements = {
            initialControls: document.getElementById('initial-controls'),
            length: document.getElementById('length'),
            summarizeBtn: document.getElementById('summarize-btn'),
            chatInterface: document.getElementById('chat-interface'),
            chatMessages: document.getElementById('chat-messages'),
            messageInput: document.getElementById('message-input'),
            sendBtn: document.getElementById('send-btn'),
            charCount: document.getElementById('char-count'),
            pageTitle: document.getElementById('page-title'),
            newChatBtn: document.getElementById('new-chat-btn'),
            suggestedQuestions: document.getElementById('suggested-questions'),
            suggestionsList: document.getElementById('suggestions-list'),
            loading: document.getElementById('loading'),
            loadingText: document.getElementById('loading-text'),
            error: document.getElementById('error'),
            errorMessage: document.getElementById('error-message'),
            retryBtn: document.getElementById('retry-btn'),
            welcome: document.getElementById('welcome'),
            sessionInfo: document.getElementById('session-info')
        };
    }
    
    attachEventListeners() {
        this.elements.summarizeBtn.addEventListener('click', () => this.handleInitialSummarize());
        this.elements.messageInput.addEventListener('input', (e) => this.handleInputChange(e));
        this.elements.messageInput.addEventListener('keydown', (e) => this.handleKeyDown(e));
        this.elements.sendBtn.addEventListener('click', () => this.handleSendMessage());
        this.elements.newChatBtn.addEventListener('click', () => this.handleNewChat());
        this.elements.retryBtn.addEventListener('click', () => this.handleRetry());
        this.elements.length.addEventListener('change', () => this.saveSettings());

        // Enable/disable send button on input
        this.elements.messageInput.addEventListener('input', () => {
            this.elements.sendBtn.disabled = this.elements.messageInput.value.trim().length === 0 || this.isLoading;
        });
    }
    
    handleInputChange(e) {
        const text = e.target.value;
        this.elements.charCount.textContent = text.length;
        this.elements.sendBtn.disabled = text.trim().length === 0 || this.isLoading;

        if (text.length > 450) {
            this.elements.charCount.style.color = '#dc3545';
        } else if (text.length > 400) {
            this.elements.charCount.style.color = '#ffc107';
        } else {
            this.elements.charCount.style.color = '#999';
        }
    }
    
    handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.handleSendMessage();
        }
    }
    
    async loadSettings() {
        try {
            const settings = await chrome.storage.sync.get(['length']);
            if (settings.length) {
                this.elements.length.value = settings.length;
            }
        } catch (error) {
            console.log('Could not load settings:', error);
        }
    }
    
    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                length: this.elements.length.value
            });
        } catch (error) {
            console.log('Could not save settings:', error);
        }
    }
    
    async extractPageContent() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('No active tab found');
            if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
                this.showError('Cannot analyze browser internal pages');
                return;
            }
            
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractContentFromPage
            });
            
            if (results && results[0] && results[0].result) {
                this.currentPageData = results[0].result;
                this.elements.summarizeBtn.disabled = false;
                this.elements.pageTitle.textContent = this.currentPageData.title;
            } else {
                throw new Error('Could not extract page content');
            }
        } catch (error) {
            console.error('Error extracting content:', error);
            this.showError('Could not extract page content. Please refresh the page and try again.');
            this.elements.summarizeBtn.disabled = true;
        }
    }
    
    async handleInitialSummarize() {
        if (!this.currentPageData) {
            this.showError('No page content available. Please refresh and try again.');
            return;
        }
        if (this.currentPageData.wordCount < 50) {
            this.showError('Page content is too short to analyze effectively.');
            return;
        }
        this.showLoading('Analyzing page and setting up chat...');
        try {
            const response = await this.callSummarizeAPI({
                content: this.currentPageData.content,
                title: this.currentPageData.title,
                url: this.currentPageData.url,
                summary_length: this.elements.length.value
            });
            
            // Store session info BEFORE displaying suggested questions
            this.currentSession = {
                id: response.session_id,
                title: this.currentPageData.title
            };
            
            // Switch interface visibility
            this.elements.initialControls.classList.add('hidden');
            this.elements.chatInterface.classList.remove('hidden');
            
            // Add initial summary as first message
            this.addMessage('assistant', response.summary);
            
            // Show follow-up questions
            this.showSuggestedQuestions(response.followup_questions);
            
            this.updateSessionInfo();
            
        } catch (error) {
            console.error('Initial analysis error:', error);
            this.showError(error.message || 'Failed to analyze page. Please try again.');
        } finally{
            this.setLoadingState(false);
            this.hideLoading();
        }
    }
    
    async handleSendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || this.isLoading || !this.currentSession) return;
        
        // Add user message to chat
        this.addMessage('user', message);
        
        // Clear input and disable send button
        this.elements.messageInput.value = '';
        this.elements.charCount.textContent = '0';
        this.elements.sendBtn.disabled = true;
        
        this.hideSuggestedQuestions();
        this.showLoading('Thinking...');

        
        try {
            const response = await this.callChatAPI({
                session_id: this.currentSession.id,
                message: message
            });
            this.addMessage('assistant', response.response);
            this.showSuggestedQuestions(response.followup_questions);
        } catch (error) {
            console.error('Chat error:', error);
            this.addMessage('assistant', '❌ Sorry, I encountered an error. Please try again.');
        } finally {
            this.hideLoading();
            this.setLoadingState(false);
        }
    }
    
    // When user clicks a suggested question, fill input and enable send button
    handleSuggestionClick(question) {
        this.elements.messageInput.value = question;
        this.elements.charCount.textContent = question.length;
        this.elements.sendBtn.disabled = false;
        this.elements.messageInput.disabled = false;
        this.elements.messageInput.focus();
    }
    
    async handleNewChat() {
        if (confirm('Start a new chat? This will clear the current conversation.')) {
            this.currentSession = null;
            this.elements.chatMessages.innerHTML = '';
            this.hideSuggestedQuestions();
            this.showInitialControls();
        }
    }
    
    handleRetry() {
        if (this.currentSession) {
            this.showChatInterface();
        } else {
            this.showInitialControls();
            this.handleInitialSummarize();
        }
    }
    
    async callSummarizeAPI(data) {
        const response = await fetch(`${this.apiUrl}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `API Error: ${response.status}`);
        }
        return await response.json();
    }
    
    async callChatAPI(data) {
        const response = await fetch(`${this.apiUrl}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `Chat Error: ${response.status}`);
        }
        return await response.json();
    }
    
    addMessage(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (role === 'assistant') {
            contentDiv.innerHTML = marked.parse(content);
        } else {
            contentDiv.textContent = content;
        }
        
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        messageDiv.appendChild(contentDiv);
        messageDiv.appendChild(timestampDiv);
        
        this.elements.chatMessages.appendChild(messageDiv);
        
        setTimeout(() => {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }, 100);
    }
    
    showSuggestedQuestions(questions) {
        if (!questions || questions.length === 0) {
            this.hideSuggestedQuestions();
            return;
        }
        
        this.elements.suggestionsList.innerHTML = '';
        
        questions.forEach(question => {
            const button = document.createElement('button');
            button.className = 'suggestion-btn';
            button.textContent = question;
            button.addEventListener('click', () => this.handleSuggestionClick(question));
            this.elements.suggestionsList.appendChild(button);
        });
        
        this.elements.suggestedQuestions.classList.remove('hidden');
    }
    
    hideSuggestedQuestions() {
        this.elements.suggestedQuestions.classList.add('hidden');
    }
    
    showChatInterface() {
        this.hideAllStates();
        this.elements.chatInterface.classList.remove('hidden');
        this.elements.messageInput.focus();
    }
    
    showInitialControls() {
        this.hideAllStates();
        this.elements.initialControls.classList.remove('hidden');
    }
    
    showLoading(text = 'Analyzing page content...') {
        this.hideAllStates();
        this.elements.loading.classList.remove('hidden');
        this.elements.loadingText.textContent = text;
        this.setLoadingState(true);
    }

    hideLoading() {
        this.elements.loading.classList.add('hidden');
    }
    
    showError(message) {
        this.hideAllStates();
        this.elements.error.classList.remove('hidden');
        this.elements.errorMessage.textContent = message;
        this.setLoadingState(false);
    }
    
    setLoadingState(loading, text = null) {
        this.isLoading = loading;
        
        if (this.elements.summarizeBtn) {
            this.elements.summarizeBtn.disabled = loading;
        }
        
        if (this.elements.sendBtn) {
            this.elements.sendBtn.disabled = loading || this.elements.messageInput.value.trim().length === 0;
        }
        
        if (this.elements.messageInput) {
            this.elements.messageInput.disabled = loading;
        }
        
        if (text && this.elements.loadingText) {
            this.elements.loadingText.textContent = text;
        }
    }
    
    hideAllStates() {
        this.elements.loading.classList.add('hidden');
        this.elements.error.classList.add('hidden');
        this.elements.welcome.classList.add('hidden');
    }
    
    updateSessionInfo() {
        if (this.currentSession) {
            this.elements.sessionInfo.textContent = `Session: ${this.currentSession.id.substring(0, 8)}...`;
        } else {
            this.elements.sessionInfo.textContent = '';
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new WebSummarizerChatbot();
});
