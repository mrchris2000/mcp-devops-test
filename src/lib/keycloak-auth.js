#!/usr/bin/env node

/**
 * Keycloak Authentication Module
 * 
 * This module handles authentication with Keycloak for the Test system.
 * It supports offline token exchange and access token management.
 * 
 * Realm: devops-automation
 * Server: Based on TEST_SERVER_URL environment variable
 */

export class KeycloakAuth {
    constructor(config) {
        this.serverURL = config.serverURL;
        this.realm = config.realm || 'devops-automation';
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret; // Optional for public clients
        this.offlineToken = config.offlineToken;
        
        // Token storage
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        
        // Derive base URL from server URL
        this.baseURL = this.extractBaseURL(this.serverURL);
        this.tokenEndpoint = `${this.baseURL}/auth/realms/${this.realm}/protocol/openid-connect/token`;
        
        console.log(`Keycloak Auth initialized:`);
        console.log(`  Base URL: ${this.baseURL}`);
        console.log(`  Realm: ${this.realm}`);
        console.log(`  Client ID: ${this.clientId}`);
        console.log(`  Token Endpoint: ${this.tokenEndpoint}`);
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
     * Exchange offline token for access token
     * This is the primary authentication method for offline tokens
     */
    async authenticateWithOfflineToken() {
        console.log('🔐 Starting offline token authentication...');
        
        if (!this.offlineToken) {
            throw new Error('Offline token is required for authentication');
        }
        
        if (!this.clientId) {
            throw new Error('Client ID is required for authentication');
        }
        
        const formData = new URLSearchParams();
        formData.append('grant_type', 'refresh_token');
        formData.append('refresh_token', this.offlineToken);
        formData.append('client_id', this.clientId);
        
        // Add client secret if provided (for confidential clients)
        if (this.clientSecret) {
            formData.append('client_secret', this.clientSecret);
        }
        
        console.log(`📡 Making token exchange request...`);
        console.log(`   Endpoint: ${this.tokenEndpoint}`);
        console.log(`   Client ID: ${this.clientId}`);
        console.log(`   Has Client Secret: ${!!this.clientSecret}`);
        
        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
                },
                body: formData
            });
            
            console.log(`📊 Response: ${response.status} ${response.statusText}`);
            
            if (response.ok) {
                const data = await response.json();
                
                this.accessToken = data.access_token;
                this.refreshToken = data.refresh_token;
                
                // Calculate token expiry
                if (data.expires_in) {
                    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                }
                
                console.log('✅ Authentication successful!');
                console.log(`   Access token length: ${this.accessToken.length}`);
                console.log(`   Token type: ${data.token_type}`);
                console.log(`   Expires in: ${data.expires_in} seconds`);
                console.log(`   Refresh token available: ${!!this.refreshToken}`);
                
                return {
                    success: true,
                    accessToken: this.accessToken,
                    refreshToken: this.refreshToken,
                    expiresIn: data.expires_in,
                    tokenType: data.token_type
                };
                
            } else {
                const errorText = await response.text();
                console.error('❌ Token exchange failed:');
                console.error(`   Status: ${response.status} ${response.statusText}`);
                console.error(`   Error: ${errorText}`);
                
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
            return {
                success: false,
                error: 'network_error',
                errorDescription: error.message
            };
        }
    }
    
    /**
     * Refresh the access token using the refresh token
     */
    async refreshAccessToken() {
        console.log('🔄 Refreshing access token...');
        
        if (!this.refreshToken) {
            console.log('⚠️  No refresh token available, falling back to offline token');
            return await this.authenticateWithOfflineToken();
        }
        
        const formData = new URLSearchParams();
        formData.append('grant_type', 'refresh_token');
        formData.append('refresh_token', this.refreshToken);
        formData.append('client_id', this.clientId);
        
        if (this.clientSecret) {
            formData.append('client_secret', this.clientSecret);
        }
        
        try {
            const response = await fetch(this.tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'
                },
                body: formData
            });
            
            if (response.ok) {
                const data = await response.json();
                
                this.accessToken = data.access_token;
                if (data.refresh_token) {
                    this.refreshToken = data.refresh_token;
                }
                
                if (data.expires_in) {
                    this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                }
                
                console.log('✅ Token refresh successful!');
                return { success: true, accessToken: this.accessToken };
                
            } else {
                console.log('⚠️  Token refresh failed, falling back to offline token');
                return await this.authenticateWithOfflineToken();
            }
            
        } catch (error) {
            console.log('⚠️  Token refresh error, falling back to offline token');
            return await this.authenticateWithOfflineToken();
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
        
        if (this.refreshToken) {
            return await this.refreshAccessToken();
        } else {
            return await this.authenticateWithOfflineToken();
        }
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
        this.refreshToken = null;
        this.tokenExpiry = null;
        console.log('🗑️  Tokens cleared');
    }
}

/**
 * Create KeycloakAuth instance from environment variables
 */
export function createKeycloakAuthFromEnv() {
    const config = {
        serverURL: process.env.TEST_SERVER_URL,
        realm: 'devops-automation',
        clientId: process.env.KEYCLOAK_CLIENT_ID || 'testserver', // Default based on your offline token
        clientSecret: process.env.KEYCLOAK_CLIENT_SECRET, // REQUIRED for testserver (confidential client)
        offlineToken: process.env.TEST_ACCESS_TOKEN
    };
    
    // Validate required config
    if (!config.serverURL) {
        throw new Error('TEST_SERVER_URL environment variable is required');
    }
    if (!config.offlineToken) {
        throw new Error('TEST_ACCESS_TOKEN environment variable is required');
    }
    
    // Check if testserver client requires client secret
    if (config.clientId === 'testserver' && !config.clientSecret) {
        console.warn('⚠️  Warning: testserver is a confidential client but no KEYCLOAK_CLIENT_SECRET provided');
        console.warn('   This will likely fail authentication. Please set KEYCLOAK_CLIENT_SECRET environment variable.');
    }
    
    return new KeycloakAuth(config);
}

export default KeycloakAuth;
