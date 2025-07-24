#!/usr/bin/env node


import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config as loadEnv } from 'dotenv';
import { createSimpleAuthFromEnv } from './simple-auth.js';
import unzipper from 'unzipper';
import stream from 'stream';

// Load environment variables from .env file if it exists
loadEnv();

// Configuration from environment variables or command line arguments
function getConfig() {
    // Parse command line arguments
    const args = process.argv.slice(2);
    const config = {};
    
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i];
        const value = args[i + 1];
        
        switch (key) {
            case '--token':
                config.token = value;
                break;
            case '--server-url':
                config.serverUrl = value;
                break;
            case '--teamspace-id':
                config.teamspaceId = value;
                break;
        }
    }
    
    // Environment variables take precedence if not provided via command line
    const personal_access_token_string = config.token || process.env.TEST_ACCESS_TOKEN;
    const serverURL = config.serverUrl || process.env.TEST_SERVER_URL;
    const teamspaceID = config.teamspaceId || process.env.TEST_TEAMSPACE_ID;
    
    // Validate required configuration
    if (!personal_access_token_string) {
        throw new Error("Personal access token is required. Set TEST_ACCESS_TOKEN environment variable or use --token argument.");
    }
    if (!serverURL) {
        throw new Error("Server URL is required. Set TEST_SERVER_URL environment variable or use --server-url argument.");
    }
    if (!teamspaceID) {
        throw new Error("Teamspace ID is required. Set TEST_TEAMSPACE_ID environment variable or use --teamspace-id argument.");
    }
    
    return { 
        personal_access_token_string, 
        serverURL, 
        teamspaceID
    };
}

// Get configuration at startup
const { personal_access_token_string, serverURL, teamspaceID } = getConfig();

// Create an MCP server
const server = new McpServer({
    name: "MCP DevOps Test",
    version: "1.0.0"
});
var globalCookies = "";

// Global authentication instance
let simpleAuth = null;

// Initialize Simple authentication
async function initializeAuthentication() {
    try {
        console.log('Using Simple authentication with /rest/tokens endpoint');
        simpleAuth = createSimpleAuthFromEnv();
        console.log('✅ Simple authentication initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize Simple authentication:', error.message);
        return false;
    }
}

// Setup authentication - using Simple auth module
async function setupAuthentication() {
    if (!simpleAuth) {
        const initSuccess = await initializeAuthentication();
        if (!initSuccess) {
            return false;
        }
    }
    
    try {
        console.log('🔐 Setting up authentication using /rest/tokens...');
        const result = await simpleAuth.authenticateWithPersonalToken();
        
        if (result.success) {
            console.log('✅ Authentication successful - access token obtained');
            if (result.note) {
                console.log(`   Note: ${result.note}`);
            }
            return true;
        } else {
            console.error('❌ Authentication failed:', result.error);
            console.error('   Description:', result.errorDescription);
            return false;
        }
    } catch (error) {
        console.error('❌ Error during authentication setup:', error.message);
        return false;
    }
}

// Get default headers for API requests
async function getDefaultHeaders() {
    try {
        const authHeader = await simpleAuth.getAuthHeader();
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Authorization': authHeader
        };
    } catch (error) {
        console.error('❌ Failed to get auth header:', error.message);
        throw error;
    }
}
// Cleanup handler
async function cleanup() {
    process.exit(0);
}

// Function to parse test log JSON and extract useful information
function parseTestLog(testLogJSON) {
    const results = {
        summary: {},
        steps: [],
        failures: [],
        screenshots: [],
        artifacts: []
    };

    // Extract basic summary information
    if (testLogJSON.id) results.summary.id = testLogJSON.id;
    if (testLogJSON.initiatedByUser) results.summary.initiatedByUser = testLogJSON.initiatedByUser;
    if (testLogJSON.startTime) results.summary.startTime = testLogJSON.startTime;
    if (testLogJSON.endTime) results.summary.endTime = testLogJSON.endTime;
    if (testLogJSON.duration) results.summary.duration = testLogJSON.duration;
    if (testLogJSON.verdict) results.summary.verdict = testLogJSON.verdict;
    if (testLogJSON.status) results.summary.status = testLogJSON.status;

    // Recursive function to extract steps and failures
    const extractStepsAndFailures = (logItem, parentPath = '', level = 0) => {
        if (!logItem) return;

        // Process the current item
        if (logItem.properties && (logItem.properties.name || logItem.type)) {
            const step = {
                id: logItem.id,
                path: parentPath ? `${parentPath}.${logItem.id}` : logItem.id,
                name: logItem.properties.name || logItem.type || 'Unnamed step',
                type: logItem.type,
                startTime: logItem.time,
                endTime: logItem.end ? logItem.end.time : null,
                duration: logItem.end ? logItem.end.duration : null,
                verdict: logItem.end ? logItem.end.properties?.verdict : 'UNKNOWN',
                properties: logItem.properties,
                level: level
            };
            
            results.steps.push(step);

            // Check for failures
            if (step.verdict === 'FAIL') {
                const failure = {
                    stepId: step.id,
                    name: step.name,
                    type: step.type,
                    time: step.endTime || step.startTime,
                    reason: logItem.end?.properties?.reason || 'Unknown failure',
                    message: logItem.end?.properties?.message || null,
                    stacktrace: logItem.end?.properties?.stacktrace || null,
                    screenshot: logItem.end?.properties?.screenshot || null,
                    properties: step.properties
                };
                results.failures.push(failure);
            }
        }

        // Process events
        if (logItem.events && Array.isArray(logItem.events)) {
            for (const event of logItem.events) {
                extractStepsAndFailures(event, parentPath ? `${parentPath}.${logItem.id}` : logItem.id, level + 1);
            }
        }

        // Process nested items if they exist
        if (logItem.items && Array.isArray(logItem.items)) {
            for (const item of logItem.items) {
                extractStepsAndFailures(item, parentPath ? `${parentPath}.${logItem.id}` : logItem.id, level + 1);
            }
        }
    };

    // Start extraction from the root
    if (Array.isArray(testLogJSON)) {
        testLogJSON.forEach(item => extractStepsAndFailures(item));
    } else {
        extractStepsAndFailures(testLogJSON);
    }

    return results;
}

process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

// Start the server
//Tool to retrieve all projects from Test system (Reference tool)
server.tool(
    "get_projects",
    "Retrieves all projects from the Test system",
    {},
    async () => {
        try {
            // Setup authentication if not already done
            if (!simpleAuth) {
                const authSuccess = await setupAuthentication();
                if (!authSuccess) {
                    throw new Error("Authentication failed");
                }
            }

            // Build API URL - use the same approach as authentication
            const cleanServerURL = serverURL.replace('/#', '');
            const apiUrl = `${cleanServerURL}/rest/projects/?member=true&archived=false`;
            
            const headers = await getDefaultHeaders();
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data && data.data && Array.isArray(data.data)) {
                const projectList = data.data.map(project => {
                    return `- ${project.name} (ID: ${project.id})${project.archived ? ' [ARCHIVED]' : ''}`;
                }).join('\n');
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Retrieved ${data.data.length} projects from Test system:\n\n${projectList}` 
                    }]
                };
            } else {
                throw new Error('Unexpected response structure');
            }
            
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Error retrieving projects: ${e.message}` }]
            };
        }
    }
);

// Tool to list tests from a specific project
server.tool(
    "list_tests",
    "Retrieves tests from a specific project with optional test type filtering",
    {
        projectId: z.string().describe("The ID of the project to retrieve tests from"),
        testType: z.string().optional().describe("Optional test type filter (e.g., EXT_TEST_SUITE, EXT_TEST_SCPT, EXT_TEST_LOADP, EXT_TEST_STUB, etc.)"),
        branch: z.string().optional().default("main").describe("Branch to use for retrieving tests (default: main)")
    },
    async (args) => {
        try {
            // Setup authentication if not already done
            if (!simpleAuth) {
                const authSuccess = await setupAuthentication();
                if (!authSuccess) {
                    throw new Error("Authentication failed");
                }
            }

            // Build API URL
            const cleanServerURL = serverURL.replace('/#', '');
            const url = new URL(cleanServerURL);
            const baseURL = `${url.protocol}//${url.host}`;
            
            // Default test types if none specified - updated to match new query format
            const defaultTestTypes = [
                "AFTSUITE",
                "APISUITE", 
                "COMPOUND",
                "EXT_TEST_CODES",
                "EXT_TEST_JMETER",
                "EXT_TEST_JUNIT",
                "EXT_TEST_PMAN",
                "RATESCHEDULE",
                "EXT_TEST_SEL",
                "EXT_TEST_SUITE",
                "VUSCHEDULE",
                "EXT_TEST_SCPT",
                "EXT_TEST_LOADP",
                "EXT_TEST_STUB",
                "APITEST",
                "UI",
                "PERF",
            ];
            
            // Use provided testType or default list
            const testTypes = args.testType ? [args.testType] : defaultTestTypes;
            
            // Build URL with multiple externalTypes parameters and new parameters
            const url_params = new URLSearchParams();
            url_params.append('revision', args.branch);
            //url_params.append('deployable', 'true');
            //url_params.append('assetTypes', 'EXECUTABLE');
            
            // Add each test type as separate externalTypes parameter
            testTypes.forEach(type => {
                url_params.append('externalTypes', type);
            });
            
            const apiUrl = `${baseURL}/test/rest/projects/${args.projectId}/assets/?${url_params.toString()}`;
            
            const headers = await getDefaultHeaders();
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            if (data && data.content && Array.isArray(data.content)) {
                const testList = data.content.map(test => {
                    return `- ${test.name} (ID: ${test.id}, Type: ${test.external_type || 'Unknown'})`;
                }).join('\n');
                
                return {
                    content: [{ 
                        type: 'text', 
                        text: `Retrieved ${data.content.length} tests from project ${args.projectId}:\n\n${testList}` 
                    }]
                };
            } else {
                throw new Error('Unexpected response structure');
            }
            
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Error retrieving tests: ${e.message}` }]
            };
        }
    }
);

// Tool to execute a test
server.tool(
    "execute_test",
    "Execute a test in a specific project by test name. TIMING: Tests typically take 60-180 seconds to complete. AGENT BEHAVIOR: After execution, inform user 'Test started, will complete in ~2 minutes', then wait at least 60 seconds before first status check. Use progressive back-off for subsequent checks: 30s → 45s → 60s → 90s intervals until completion.",
    {
        projectId: z.string().describe("The ID of the project containing the test"),
        testName: z.string().describe("The name of the test to execute"),
        browserName: z.string().optional().default("edge").describe("Browser to use for execution (default: edge)"),
        revision: z.string().optional().default("main").describe("Revision to use (default: main)")
    },
    async (args) => {
        try {
            // Setup authentication if not already done
            if (!simpleAuth) {
                const authSuccess = await setupAuthentication();
                if (!authSuccess) {
                    throw new Error("Authentication failed");
                }
            }

            // First, get the list of tests to find the asset ID for the given test name
            const cleanServerURL = serverURL.replace('/#', '');
            const url = new URL(cleanServerURL);
            const baseURL = `${url.protocol}//${url.host}`;
            
            // Get tests to find the asset ID - updated to match new query format
            const defaultTestTypes = [
                "AFTSUITE",
                "APISUITE", 
                "COMPOUND",
                "EXT_TEST_CODES",
                "EXT_TEST_JMETER",
                "EXT_TEST_JUNIT",
                "EXT_TEST_PMAN",
                "RATESCHEDULE",
                "EXT_TEST_SEL",
                "EXT_TEST_SUITE",
                "VUSCHEDULE",
                "EXT_TEST_SCPT",
                "EXT_TEST_LOADP",
                "EXT_TEST_STUB",
                "APITEST",
                "UI",
                "PERF",
            ];
            
            // Build URL with multiple externalTypes parameters and new parameters
            const url_params = new URLSearchParams();
            url_params.append('revision', args.revision);
            url_params.append('deployable', 'true');
            url_params.append('assetTypes', 'EXECUTABLE');
            
            // Add each test type as separate externalTypes parameter
            defaultTestTypes.forEach(type => {
                url_params.append('externalTypes', type);
            });
            
            const testsApiUrl = `${baseURL}/test/rest/projects/${args.projectId}/assets/?${url_params.toString()}`;
            
            const testsHeaders = await getDefaultHeaders();
            const testsResponse = await fetch(testsApiUrl, {
                method: 'GET',
                headers: testsHeaders
            });

            if (!testsResponse.ok) {
                throw new Error(`Failed to fetch tests: HTTP ${testsResponse.status}: ${testsResponse.statusText}`);
            }

            const testsData = await testsResponse.json();
            
            if (!testsData || !testsData.content || !Array.isArray(testsData.content)) {
                throw new Error('Unexpected response structure when fetching tests');
            }

            // Find the test by name
            const test = testsData.content.find(t => t.name === args.testName);
            if (!test) {
                const availableTests = testsData.content.map(t => t.name).join(', ');
                throw new Error(`Test "${args.testName}" not found. Available tests: ${availableTests}`);
            }

            const assetId = test.id;
            
            // Now execute the test with the found asset ID
            const apiUrl = `${baseURL}/test/rest/projects/${args.projectId}/executions/`;
            
            // Prepare the payload
            const payload = {
                testAsset: {
                    assetId: assetId,
                    revision: args.revision,
                    requestedVersion: null
                },
                advancedSettings: {
                    configuration: {
                        "browser.name": args.browserName
                    }
                },
                remoteLocations: [],
                offlineToken: personal_access_token_string
            };

            const executionHeaders = await getDefaultHeaders();
            // Add additional headers specific to test execution - updated to match new format
            executionHeaders['Content-Type'] = 'application/json';
            executionHeaders['Accept'] = 'application/json, text/plain, */*';
            executionHeaders['Accept-Version'] = '1.4';
            executionHeaders['X-Requested-With'] = 'XMLHttpRequest';
            executionHeaders['Sec-Fetch-Dest'] = 'empty';
            executionHeaders['Sec-Fetch-Mode'] = 'cors';
            executionHeaders['Sec-Fetch-Site'] = 'same-origin';
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: executionHeaders,
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            
            return {
                content: [{ 
                    type: 'text', 
                    text: `Test execution started successfully!\n\nExecution Details:\n- Test Name: ${args.testName}\n- Execution ID: ${data.id || 'N/A'}\n- Status: ${data.status || 'N/A'}\n- Project ID: ${args.projectId}\n- Asset ID: ${assetId}\n- Browser: ${args.browserName}\n- Revision: ${args.revision}\n\nResponse: ${JSON.stringify(data, null, 2)}` 
                }]
            };
            
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Error executing test: ${e.message}` }]
            };
        }
    }
);

// Tool to get test execution results/report
server.tool(
    "get_test_results",
    "Get comprehensive test execution results and report data. PROGRESSIVE POLLING: If status is RUNNING, wait using progressive back-off: 30s → 45s → 60s → 90s between checks. Tests typically complete in 60-180 seconds.",
    {
        projectId: z.string().describe("The ID of the project containing the test"),
        resultId: z.string().describe("The result ID from the test execution"),
        executionId: z.string().optional().describe("Optional execution ID for additional context")
    },
    async (args) => {
        try {
            // Setup authentication if not already done
            if (!simpleAuth) {
                const authSuccess = await setupAuthentication();
                if (!authSuccess) {
                    throw new Error("Authentication failed");
                }
            }

            const cleanServerURL = serverURL.replace('/#', '');
            const url = new URL(cleanServerURL);
            const baseURL = `${url.protocol}//${url.host}`;
            
            const headers = await getDefaultHeaders();
            
            // Initialize result object to collect essential data
            const resultData = {
                summary: null,
                logs: null,
                artifacts: null,
                screenshots: null,
                performance: null
            };

            // Get main result summary
            try {
                const summaryUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}`;
                const summaryResponse = await fetch(summaryUrl, {
                    method: 'GET',
                    headers: headers
                });

                if (summaryResponse.ok) {
                    resultData.summary = await summaryResponse.json();
                }
            } catch (error) {
                // Silent fail - summary will be null
            }

            // Get execution logs
            try {
                const logsUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}/logs`;
                const logsResponse = await fetch(logsUrl, {
                    method: 'GET',
                    headers: headers
                });

                if (logsResponse.ok) {
                    resultData.logs = await logsResponse.json();
                }
            } catch (error) {
                // Silent fail - logs will be null
            }

            // Parse detailed step information from logs
            const parseStepDetails = (logs) => {
                const steps = [];
                if (!logs || !Array.isArray(logs)) return steps;

                const findStepsRecursively = (logItem, parentPath = '', level = 0) => {
                    // Add this item as a step if it has meaningful properties
                    if (logItem.properties && (logItem.properties.name || logItem.type)) {
                        const stepInfo = {
                            id: logItem.id,
                            path: parentPath ? `${parentPath}.${logItem.id}` : logItem.id,
                            name: logItem.properties.name || logItem.type || 'Unnamed step',
                            type: logItem.type,
                            startTime: logItem.time,
                            endTime: logItem.end ? logItem.end.time : null,
                            duration: logItem.end ? logItem.end.duration : null,
                            verdict: logItem.end ? logItem.end.properties?.verdict : 'UNKNOWN',
                            properties: logItem.properties,
                            events: logItem.events || [],
                            verdicts: logItem.end ? logItem.end.verdicts : null,
                            level: level
                        };
                        
                        steps.push(stepInfo);
                    }

                    // Process events as potential steps
                    if (logItem.events && Array.isArray(logItem.events)) {
                        for (const event of logItem.events) {
                            if (event.type && (event.type.includes('step') || event.type.includes('config') || event.type.includes('device'))) {
                                const eventStep = {
                                    id: event.id,
                                    path: `${parentPath}.${event.id}`,
                                    name: event.properties?.name || event.type,
                                    type: event.type,
                                    startTime: event.time,
                                    endTime: null,
                                    duration: null,
                                    verdict: 'INFO',
                                    properties: event.properties,
                                    isEvent: true,
                                    level: level + 1
                                };
                                steps.push(eventStep);
                            }
                        }
                    }
                };

                // Process each top-level log item
                for (const logItem of logs) {
                    findStepsRecursively(logItem);
                }

                return steps;
            };

            const parsedSteps = parseStepDetails(resultData.logs);

            // Get optional additional data
            try {
                const artifactsUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}/artifacts`;
                const artifactsResponse = await fetch(artifactsUrl, {
                    method: 'GET',
                    headers: headers
                });

                if (artifactsResponse.ok) {
                    resultData.artifacts = await artifactsResponse.json();
                }
            } catch (error) {
                // Silent fail
            }

            try {
                const screenshotsUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}/screenshots`;
                const screenshotsResponse = await fetch(screenshotsUrl, {
                    method: 'GET',
                    headers: headers
                });

                if (screenshotsResponse.ok) {
                    resultData.screenshots = await screenshotsResponse.json();
                }
            } catch (error) {
                // Silent fail
            }

            try {
                const performanceUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}/performance`;
                const performanceResponse = await fetch(performanceUrl, {
                    method: 'GET',
                    headers: headers
                });

                if (performanceResponse.ok) {
                    resultData.performance = await performanceResponse.json();
                }
            } catch (error) {
                // Silent fail
            }

            // Create comprehensive report
            let reportText = `# Test Execution Results Report\n\n`;
            reportText += `**Project ID**: ${args.projectId}\n`;
            reportText += `**Result ID**: ${args.resultId}\n`;
            if (args.executionId) {
                reportText += `**Execution ID**: ${args.executionId}\n`;
            }
            reportText += `**Report URL**: ${baseURL}/test/funrep.html#/projects/${args.projectId}/results/${args.resultId}\n\n`;



            // Summary section
            if (resultData.summary) {
                reportText += `## Test Summary\n`;
                reportText += `- **Status**: ${resultData.summary.status || 'Unknown'}\n`;
                reportText += `- **Verdict**: ${resultData.summary.verdict || 'Unknown'}\n`;
                reportText += `- **Start Time**: ${new Date(resultData.summary.startDate || resultData.summary.creationDate).toISOString()}\n`;
                reportText += `- **Duration**: ${resultData.summary.duration ? (resultData.summary.duration / 1000) + ' seconds' : 'N/A'}\n`;
                reportText += `- **Test Name**: ${resultData.summary.name || 'N/A'}\n`;
                reportText += `- **Branch**: ${resultData.summary.branch || 'N/A'}\n\n`;
            }



            // Available Reports
            if (resultData.summary && resultData.summary.reports) {
                reportText += `## 📊 Available Reports Analysis\n`;
                reportText += `The test summary shows ${resultData.summary.reports.length} available reports:\n\n`;
                resultData.summary.reports.forEach((report, index) => {
                    reportText += `### Report ${index + 1}: ${report.name}\n`;
                    reportText += `- **ID**: ${report.id}\n`;
                    reportText += `- **Content Type**: ${report['content-type']}\n`;
                    reportText += `- **Exportable**: ${report.exportable}\n`;
                    reportText += `- **URL**: ${report.href}\n`;
                    reportText += `- **Last Updated**: ${report.lastUpdated}\n\n`;
                });
            }

            // Step Analysis
            if (parsedSteps.length > 0) {
                reportText += `## Step-by-Step Analysis (Hierarchical)\n`;
                reportText += `Found ${parsedSteps.length} steps/events:\n\n`;
                
                parsedSteps.forEach((step, index) => {
                    const status = step.verdict === 'FAIL' ? '❌ FAILED' : 
                                 step.verdict === 'PASS' ? '✅ PASSED' : 
                                 step.verdict === 'INFO' ? 'ℹ️ INFO' :
                                 '⚪ UNKNOWN';
                    
                    // Create indentation based on hierarchy level
                    const indent = '  '.repeat(step.level || 0);
                    const stepNumber = step.level === 0 ? `${index + 1}` : `${index + 1}`;
                    
                    reportText += `${indent}### Step ${stepNumber}: ${step.name}\n`;
                    reportText += `${indent}- **ID**: ${step.id}\n`;
                    reportText += `${indent}- **Status**: ${status}\n`;
                    reportText += `${indent}- **Type**: ${step.type}\n`;
                    reportText += `${indent}- **Start Time**: ${step.startTime}\n`;
                    if (step.endTime) reportText += `${indent}- **End Time**: ${step.endTime}\n`;
                    if (step.duration) reportText += `${indent}- **Duration**: ${step.duration}\n`;
                    if (step.level > 0) reportText += `${indent}- **Level**: ${step.level} (substep)\n`;
                    
                    if (step.verdict === 'FAIL') {
                        reportText += `${indent}- **🚨 FAILURE DETECTED IN THIS STEP**\n`;
                        
                        // Add detailed failure information
                        if (step.properties) {
                            reportText += `${indent}- **Failure Context**:\n`;
                            if (step.properties.fragment) reportText += `${indent}  - Fragment: ${step.properties.fragment}\n`;
                            if (step.properties.object) reportText += `${indent}  - Object: ${step.properties.object}\n`;
                            if (step.properties.value) reportText += `${indent}  - Value: ${step.properties.value}\n`;
                            if (step.properties.key) reportText += `${indent}  - Key: ${step.properties.key}\n`;
                            if (step.properties.parent) reportText += `${indent}  - Parent: ${step.properties.parent}\n`;
                        }
                    }
                    
                    // Show step-specific properties
                    if (step.type && step.type.includes('click') && step.properties) {
                        reportText += `${indent}- **Action**: Click on ${step.properties.object || 'element'}\n`;
                    } else if (step.type && step.type.includes('type') && step.properties) {
                        reportText += `${indent}- **Action**: Type "${step.properties.value || 'text'}" into ${step.properties.object || 'element'}\n`;
                    } else if (step.type && step.type.includes('press') && step.properties) {
                        reportText += `${indent}- **Action**: Press key "${step.properties.key || 'unknown'}"\n`;
                    } else if (step.type && step.type.includes('config') && step.properties) {
                        reportText += `${indent}- **Configuration**: ${JSON.stringify(step.properties, null, 2)}\n`;
                    } else if (step.type && step.type.includes('device') && step.properties) {
                        reportText += `${indent}- **Device Info**: ${JSON.stringify(step.properties, null, 2)}\n`;
                    }
                    
                    if (step.verdicts && Object.keys(step.verdicts).length > 0) {
                        reportText += `${indent}- **Verdict Summary**: ${JSON.stringify(step.verdicts, null, 2)}\n`;
                    }
                    
                    reportText += `\n`;
                });
            }

            // Failure Analysis
            const failedSteps = parsedSteps.filter(step => step.verdict === 'FAIL');
            if (failedSteps.length > 0) {
                reportText += `## 🚨 Failure Analysis\n`;
                reportText += `Found ${failedSteps.length} failed step(s):\n\n`;
                
                failedSteps.forEach((failedStep, index) => {
                    reportText += `### Failed Step ${index + 1}: ${failedStep.name}\n`;
                    reportText += `- **Step ID**: ${failedStep.id}\n`;
                    reportText += `- **Step Type**: ${failedStep.type}\n`;
                    reportText += `- **Failure Time**: ${failedStep.endTime || failedStep.startTime}\n`;
                    
                    if (failedStep.properties) {
                        reportText += `- **Step Details**: \`\`\`json\n${JSON.stringify(failedStep.properties, null, 2)}\n\`\`\`\n`;
                    }
                    
                    reportText += `\n`;
                });
            }



            // Artifacts section
            if (resultData.artifacts && resultData.artifacts.length > 0) {
                reportText += `## Artifacts\n`;
                resultData.artifacts.forEach(artifact => {
                    reportText += `- ${artifact.name || artifact.type || 'Unnamed artifact'}\n`;
                });
                reportText += `\n`;
            }

            // Screenshots section
            if (resultData.screenshots && resultData.screenshots.length > 0) {
                reportText += `## Screenshots\n`;
                reportText += `Found ${resultData.screenshots.length} screenshot(s)\n\n`;
            }

            // Performance section
            if (resultData.performance) {
                reportText += `## Performance Data\n`;
                reportText += `Performance metrics available\n\n`;
            }

            reportText += `## Raw Data (All Endpoints)\n`;
            reportText += `\`\`\`json\n${JSON.stringify(resultData, null, 2)}\`\`\``;

            return {
                content: [{ 
                    type: 'text', 
                    text: reportText
                }]
            };
            
        } catch (e) {
            return {
                content: [{ type: 'text', text: `Error retrieving test results: ${e.message}` }]
            };
        }
    }
);

// Tool to prepare download and get download ID from location header
server.tool(
  "prepare_test_download",
  "Prepare test result download and extract download ID from location header",
  {
    projectId: z.string().describe("The ID of the project containing the test"),
    resultId: z.string().describe("The result ID from the test execution")
  },
  async (args) => {
    try {
      if (!simpleAuth) {
        const authSuccess = await setupAuthentication();
        if (!authSuccess) {
          throw new Error("Authentication failed");
        }
      }

      const cleanServerURL = serverURL.replace('/#', '');
      const url = new URL(cleanServerURL);
      const baseURL = `${url.protocol}//${url.host}`;
      const headers = await getDefaultHeaders();

      const prepareUrl = `${baseURL}/test/rest/projects/${args.projectId}/results/${args.resultId}/reports/testlog/download`;
      console.log(`Preparing download from: ${prepareUrl}`);

      const prepareResponse = await fetch(prepareUrl, {
        method: 'POST',
        headers: headers
      });

      if (!prepareResponse.ok) {
        throw new Error(`Failed to prepare download: ${prepareResponse.status} ${prepareResponse.statusText}`);
      }

      // Extract download ID from location header
      const locationHeader = prepareResponse.headers.get('location');
      if (!locationHeader) {
        throw new Error('No location header found in response');
      }

      // Extract download ID from location path (e.g., /test/rest/projects/1150/downloads/1556 -> 1556)
      const downloadIdMatch = locationHeader.match(/\/downloads\/(\d+)$/);
      if (!downloadIdMatch) {
        throw new Error(`Could not extract download ID from location header: ${locationHeader}`);
      }

      const downloadId = downloadIdMatch[1];

      return {
        content: [{ 
          type: 'text', 
          text: `Download preparation successful!\n\n**Project ID**: ${args.projectId}\n**Result ID**: ${args.resultId}\n**Download ID**: ${downloadId}\n**Location Header**: ${locationHeader}\n**Prepare URL**: ${prepareUrl}\n\nUse the download ID "${downloadId}" with the get_test_log_results tool to download and analyze the test logs.` 
        }]
      };

    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error preparing test download: ${error.message}` }]
      };
    }
  }
);

// Tool to get test log results by downloading the zip archive
server.tool(
  "get_test_log_results",
  "Download and analyze test log results from the zip archive",
  {
    projectId: z.string().describe("The ID of the project containing the test"),
    downloadId: z.string().describe("The download ID for the result archive (e.g., from result execution)")
  },
  async (args) => {
    try {
      if (!simpleAuth) {
        const authSuccess = await setupAuthentication();
        if (!authSuccess) {
          throw new Error("Authentication failed");
        }
      }

      const cleanServerURL = serverURL.replace('/#', '');
      const url = new URL(cleanServerURL);
      const baseURL = `${url.protocol}//${url.host}`;
      const headers = await getDefaultHeaders();

      const downloadUrl = `${baseURL}/test/rest/projects/${args.projectId}/downloads/${args.downloadId}`;
      console.log(`Downloading test results from: ${downloadUrl}`);

      const downloadResponse = await fetch(downloadUrl, {
        method: 'GET',
        headers: headers
      });

      if (!downloadResponse.ok) {
        throw new Error(`Failed to download results: ${downloadResponse.status} ${downloadResponse.statusText}`);
      }

      // Wait 2 seconds before processing the zip
      await new Promise(resolve => setTimeout(resolve, 2000));
      
        const zipChunks = [];
        for await (const chunk of downloadResponse.body) {
            zipChunks.push(chunk);
        }
        const zipData = Buffer.concat(zipChunks);
      

      // Extract testlog.json from the zip
      const directory = await unzipper.Open.buffer(zipData);
      const testLogFile = directory.files.find(f => f.path.endsWith('testlog.json') && f.type === 'File');

      if (!testLogFile) {
        throw new Error(`testlog.json not found in archive`);
      }

      const testLogContent = await testLogFile.buffer();
      const testLogJSON = JSON.parse(testLogContent.toString('utf-8'));

      // Parse the log as before
      const results = parseTestLog(testLogJSON);

      let reportText = `# Test Log Results Analysis (Zip Extraction)\n\n`;
      reportText += `**Project ID**: ${args.projectId}\n`;
      reportText += `**Download ID**: ${args.downloadId}\n`;
      reportText += `**Download URL**: ${downloadUrl}\n`;
      reportText += `**Archive Size**: ${zipData.length} bytes\n\n`;

      reportText += `## ✅ testlog.json extracted and parsed successfully\n`;
      reportText += `- 📝 Test Summary ID: ${results.summary.id}\n`;
      reportText += `- 👤 Initiated By: ${results.summary.initiatedByUser || 'Unknown'}\n`;
      reportText += `- 🧪 Total Steps: ${results.steps.length}\n`;
      reportText += `- ❌ Failures: ${results.failures.length}\n\n`;

      if (results.failures.length > 0) {
        reportText += `### ❌ Failure Details\n`;
        results.failures.forEach((fail, i) => {
          reportText += `- ${i + 1}. **${fail.name}** (Reason: ${fail.reason || 'N/A'})\n`;
          if (fail.message) reportText += `   ↳ Message: ${fail.message}\n`;
          if (fail.stacktrace) reportText += `   ↳ Stacktrace: Present\n`;
          if (fail.screenshot) reportText += `   ↳ Screenshot: Captured\n`;
          reportText += `\n`;
        });
      }

      return {
        content: [{ type: 'text', text: reportText }]
      };

    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error getting test log results: ${error.message}` }]
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
