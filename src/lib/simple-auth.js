#!/usr/bin/env node

/**
 * Simple Token Authentication Module
 * 
 * This module handles authentication using the /rest/tokens endpoint instead of Keycloak.
 * It's a simplified approach that uses personal access tokens directly.
 */

export class SimpleAuth {
    constructor(config) {
        this.serverURL = config.serverURL;
        this.personalAccessToken = config.personalAccessToken;
        
        // Derive base URL from server URL
        this.baseURL = this.extractBaseURL(this.serverURL);
        this.tokenEndpoint = `${this.baseURL}/rest/tokens`;
        
        // Token storage
        this.accessToken = null;
        this.tokenExpiry = null;
        
        console.log(`Simple Auth initialized:`);
        console.log(`  Base URL: ${this.baseURL}`);
        console.log(`  Token Endpoint: ${this.tokenEndpoint}`);
        console.log(`  Has Personal Access Token: ${!!this.personalAccessToken}`);
    }
    
    /**
     * Extract base URL from server URL (remove path components and hash)
     */
    extractBaseURL(serverURL) {
        const cleanURL = serverURL.replace('/#', '');
        const url = new URL(cleanURL);
        return `${url.protocol}//${url.host}`;
    }
    
    /**
     * Check if we have a valid access token
     */
    hasValidToken() {
        if (!this.accessToken) return false;
        if (!this.tokenExpiry) return true; // No expiry info, assume valid
        
        // Check if token expires in the next 60 seconds
        const now = Date.now();
        const expiryBuffer = 60 * 1000; // 60 seconds
        return this.tokenExpiry > (now + expiryBuffer);
    }
    
    /**
     * Authenticate using personal access token via /rest/tokens
     */
    async authenticateWithPersonalToken() {
        console.log('🔐 Starting authentication with personal access token...');
        
        if (!this.personalAccessToken) {
            throw new Error('Personal access token is required for authentication');
        }
        
        console.log(`📡 Making token request to: ${this.tokenEndpoint}`);
        
        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Authorization': `Bearer ${this.personalAccessToken}`
                },
                body: JSON.stringify({
                    // Include any required payload for token exchange
                    // This may need to be adjusted based on the API requirements
                })
            });
            
            console.log(`📊 Response: ${response.status} ${response.statusText}`);
            
            if (response.ok) {
                const data = await response.json();
                
                // For simple auth, we might just use the personal access token directly
                // or the API might return a new token
                if (data.access_token || data.token) {
                    this.accessToken = data.access_token || data.token;
                } else {
                    // If no token in response, use the personal access token directly
                    this.accessToken = this.personalAccessToken;
                }
                
                // Calculate token expiry if provided
                if (data.expires_in) {
                    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                } else {
                    // Default to 1 hour expiry if not specified
                    this.tokenExpiry = Date.now() + (3600 * 1000);
                }
                
                console.log('✅ Authentication successful!');
                console.log(`   Access token length: ${this.accessToken.length}`);
                console.log(`   Token type: ${data.token_type || 'Bearer'}`);
                console.log(`   Expires in: ${data.expires_in || 3600} seconds`);
                
                return {
                    success: true,
                    accessToken: this.accessToken,
                    expiresIn: data.expires_in || 3600,
                    tokenType: data.token_type || 'Bearer'
                };
                
            } else {
                const errorText = await response.text();
                console.error('❌ Token request failed:');
                console.error(`   Status: ${response.status} ${response.statusText}`);
                console.error(`   Error: ${errorText}`);
                
                // For 401/403, try using the personal access token directly
                if (response.status === 401 || response.status === 403) {
                    console.log('⚠️  Token endpoint authentication failed, using personal access token directly...');
                    this.accessToken = this.personalAccessToken;
                    this.tokenExpiry = Date.now() + (3600 * 1000); // 1 hour default
                    
                    return {
                        success: true,
                        accessToken: this.accessToken,
                        expiresIn: 3600,
                        tokenType: 'Bearer',
                        note: 'Using personal access token directly'
                    };
                }
                
                let errorDetails;
                try {
                    errorDetails = JSON.parse(errorText);
                } catch (e) {
                    errorDetails = { error: 'unknown', error_description: errorText };
                }
                
                return {
                    success: false,
                    error: errorDetails.error,
                    errorDescription: errorDetails.error_description,
                    status: response.status
                };
            }
            
        } catch (error) {
            console.error('❌ Network error during authentication:', error.message);
            
            // Fallback: use personal access token directly
            console.log('⚠️  Network error, using personal access token directly as fallback...');
            this.accessToken = this.personalAccessToken;
            this.tokenExpiry = Date.now() + (3600 * 1000); // 1 hour default
            
            return {
                success: true,
                accessToken: this.accessToken,
                expiresIn: 3600,
                tokenType: 'Bearer',
                note: 'Fallback: using personal access token directly due to network error'
            };
        }
    }
    
    /**
     * Get a valid access token (handles automatic refresh)
     */
    async getAccessToken() {
        if (this.hasValidToken()) {
            console.log('✅ Using existing valid access token');
            return { success: true, accessToken: this.accessToken };
        }
        
        console.log('🔄 Access token expired or missing, obtaining new token...');
        return await this.authenticateWithPersonalToken();
    }
    
    /**
     * Get authorization header for API requests
     */
    async getAuthHeader() {
        const result = await this.getAccessToken();
        if (result.success) {
            return `Bearer ${result.accessToken}`;
        } else {
            throw new Error(`Authentication failed: ${result.errorDescription || result.error}`);
        }
    }
    
    /**
     * Clear stored tokens
     */
    clearTokens() {
        this.accessToken = null;
        this.tokenExpiry = null;
        console.log('🗑️  Tokens cleared');
    }
}

/**
 * Create SimpleAuth instance from environment variables
 */
export function createSimpleAuthFromEnv() {
    const config = {
        serverURL: process.env.TEST_SERVER_URL,
        personalAccessToken: process.env.TEST_ACCESS_TOKEN
    };
    
    // Validate required config
    if (!config.serverURL) {
        throw new Error('TEST_SERVER_URL environment variable is required');
    }
    if (!config.personalAccessToken) {
        throw new Error('TEST_ACCESS_TOKEN environment variable is required');
    }
    
    return new SimpleAuth(config);
}

export default SimpleAuth;
