
//It is a Popup Script that handles the extension popup interface(popup.html and css) and communication with background scripts(background.js)

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



class WebSummarizerPopup {
    constructor() {
        this.apiUrl = 'http://localhost:8000';  // FastAPI backend url can be seen here
        this.elements = {};
        this.currentPageData = null;
        
        this.init();
    }
    
    //Initialize the popup interface
    init() {
        this.bindElements();
        this.attachEventListeners();
        this.loadSettings();
        this.extractPageContent();
    }
    
    //We bind the DOM elements to properties for easy access
    bindElements() {
        this.elements = {
            length: document.getElementById('length'),
            summarizeBtn: document.getElementById('summarize-btn'),
            loading: document.getElementById('loading'),
            error: document.getElementById('error'),
            errorMessage: document.getElementById('error-message'),
            retryBtn: document.getElementById('retry-btn'),
            result: document.getElementById('result'),
            summaryText: document.getElementById('summary-text'),
            wordCount: document.getElementById('word-count'),
            providerUsed: document.getElementById('provider-used'),
            copyBtn: document.getElementById('copy-btn'),
            newSummaryBtn: document.getElementById('new-summary-btn'),
            welcome: document.getElementById('welcome')
        };
    }
    
    //Attaching event listeners to interactive elements for the ease of getting the value
    attachEventListeners() {
        this.elements.summarizeBtn.addEventListener('click', () => this.handleSummarize());
        this.elements.retryBtn.addEventListener('click', () => this.handleSummarize());
        this.elements.copyBtn.addEventListener('click', () => this.handleCopy());
        this.elements.newSummaryBtn.addEventListener('click', () => this.handleNewSummary());
        
        // Save settings when changed
        this.elements.length.addEventListener('change', () => this.saveSettings());
    }
    
    //Loading saved user settings from chrome.storage
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
    
    //Save current settings to chrome.storage
    
    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                length: this.elements.length.value
            });
        } catch (error) {
            console.log('Could not save settings:', error);
        }
    }
    
    //Extract content from the current active tab
    async extractPageContent() {
        try {
            // Get the active tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('No active tab found');
            }
            
            // Check if the tab URL is supported
            if (
                !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('moz-extension://')) {
                this.showError('Cannot summarize browser internal pages');
                return;
            }
            
            // Inject content script and extract page data
            const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractContentFromPage
            });
            
            if (results && results[0] && results[0].result) {
                this.currentPageData = results[0].result;
                this.elements.summarizeBtn.disabled = false;
            } else {
                throw new Error('Could not extract page content');
            }
            
        } catch (error) {
            console.error('Error extracting content:', error);
            this.showError('Could not extract page content. Please refresh the page and try again.');
            this.elements.summarizeBtn.disabled = true;
        }
    }
    

    async handleSummarize() {
        if (!this.currentPageData) {
            this.showError('No page content available. Please refresh and try again.');
            return;
        }
        
        if (this.currentPageData.wordCount < 50) {
            this.showError('Page content is too short to summarize effectively.');
            return;
        }
        
        this.showLoading();
        
        try {
            const response = await this.callSummarizeAPI({
                content: this.currentPageData.content,
                title: this.currentPageData.title,
                url: this.currentPageData.url,
                summary_length: this.elements.length.value
            });
            
            this.showResult(response);
            
        } catch (error) {
            console.error('Summarization error:', error);
            this.showError(error.message || 'Failed to generate summary. Please try again.');
        }
    }
    
    //Make API call to the FastAPI backend
    async callSummarizeAPI(data) {
        const response = await fetch(`${this.apiUrl}/summarize`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || `API Error: ${response.status}`);
        }
        
        return await response.json();
    }
    
    //Show loading state
    showLoading() {
        this.hideAllStates();
        this.elements.loading.classList.remove('hidden');
        this.elements.summarizeBtn.disabled = true;
    }
    
    //Show error state
    showError(message) {
        this.hideAllStates();
        this.elements.error.classList.remove('hidden');
        this.elements.errorMessage.textContent = message;
        this.elements.summarizeBtn.disabled = false;
    }
    
    //Show result state
    showResult(data) {
        this.hideAllStates();
        this.elements.result.classList.remove('hidden');
        
        this.elements.summaryText.textContent = data.summary;
        this.elements.wordCount.textContent = `${data.word_count} words`;
        
        this.elements.summarizeBtn.disabled = false;
    }
    
    //Hide all state displays
    hideAllStates() {
        this.elements.loading.classList.add('hidden');
        this.elements.error.classList.add('hidden');
        this.elements.result.classList.add('hidden');
        this.elements.welcome.classList.add('hidden');
    }
    
    //Handle copy to clipboard
    async handleCopy() {
        try {
            await navigator.clipboard.writeText(this.elements.summaryText.textContent);
            
            // Show success feedback
            const originalText = this.elements.copyBtn.textContent;
            this.elements.copyBtn.textContent = '✅ Copied!';
            this.elements.copyBtn.classList.add('success');
            
            setTimeout(() => {
                this.elements.copyBtn.textContent = originalText;
                this.elements.copyBtn.classList.remove('success');
            }, 2000);
            
        } catch (error) {
            console.error('Copy failed:', error);
            // Fallback for older browsers
            this.fallbackCopy();
        }
    }
    
    //Fallback copy method for older browsers
    fallbackCopy() {
        const textArea = document.createElement('textarea');
        textArea.value = this.elements.summaryText.textContent;
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
            this.elements.copyBtn.textContent = '✅ Copied!';
            setTimeout(() => {
                this.elements.copyBtn.textContent = '📋 Copy';
            }, 2000);
        } catch (error) {
            console.error('Fallback copy failed:', error);
        }
        
        document.body.removeChild(textArea);
    }
    
    //Handle new summary request
    handleNewSummary() {
        this.elements.welcome.classList.remove('hidden');
        this.hideAllStates();
        this.elements.welcome.classList.add('hidden');
        
        // Re-enable summarize button
        this.elements.summarizeBtn.disabled = false;
    }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new WebSummarizerPopup();
});