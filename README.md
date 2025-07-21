# MCP DevOps Test Server

A Model Context Protocol (MCP) server implementation for DevOps Test, enabling test execution and management through standardized MCP clients.

## Features

- Retrieve projects from the Test system
- List tests from specific projects with optional filtering
- Execute tests in projects with browser selection
- Monitor test execution results and status
- Download and analyze test logs from execution archives

## Warranties
This MCP server is provided "as is" without any warranties. It is designed to work with the DevOps Test system and may require specific configurations to function correctly. Users are responsible for ensuring compatibility with their Test instance.
This server provides test execution functionality, the author is not liable for any issues arising from test execution or system interactions.

## Example Use Cases

### 1. Automated Test Execution Pipeline
**Scenario**: You're a QA engineer who needs to execute a suite of tests across different projects and monitor their results.

**Steps**:
1. "Get me all available projects in the Test system"
2. "Show me all tests in the 'WebApp Testing' project"
3. "Execute the 'LoginFunctionalityTest' in the WebApp Testing project using Chrome browser"
4. "Check the results of the test execution and get the detailed report"
5. "Download the test logs for further analysis"

**Benefits**: Streamline test execution and monitoring without manual interface interaction.

### 2. Cross-Browser Test Validation
**Scenario**: You need to validate functionality across different browsers for a critical release.

**Steps**:
1. "List all UI tests in the 'E-commerce Platform' project"
2. "Execute the 'CheckoutProcessTest' using Edge browser"
3. "Monitor the test results and wait for completion"
4. "Execute the same test using Chrome browser for comparison"
5. "Download logs from both executions to compare results"

**Benefits**: Efficiently coordinate cross-browser testing and result comparison.

### 3. Continuous Integration Test Monitoring
**Scenario**: You're monitoring test results as part of a CI/CD pipeline and need real-time status updates.

**Steps**:
1. "Get all projects and identify the relevant test project"
2. "List tests of type 'EXT_TEST_SUITE' for automated test suites"
3. "Execute critical test suites for the latest build"
4. "Continuously monitor test execution status until completion"
5. "Retrieve comprehensive test results and logs for CI reporting"

**Benefits**: Integrate test execution monitoring into automated workflows and CI/CD pipelines.
4. "Create a dependent task 'Integrate user profile API' in the 'Frontend' component"
5. "Check work items assigned to backend team members to see their current workload"

**Benefits**: Coordinate cross-functional work and ensure proper dependency tracking.

## Configuration

The server requires configuration for authentication and connection to your Test instance. You can provide configuration in several ways:

### Quick Setup (Recommended)

Run the interactive setup script:

```bash
npm run setup
```

This will prompt you for your configuration values and create a `.env` file automatically.

### Option 1: Environment Variables

Set the following environment variables:

```bash
export TEST_ACCESS_TOKEN="your_base64_encoded_token_here"
export TEST_SERVER_URL="https://your-test-server.com/test"
export TEST_TEAMSPACE_ID="your-teamspace-id-here"
export KEYCLOAK_CLIENT_ID="your-keycloak-client-id"
export KEYCLOAK_CLIENT_SECRET="your-keycloak-client-secret"
```

### Option 2: Command Line Arguments

Pass configuration as command line arguments:

```bash
node src/lib/server.js --token "your_token" --server-url "https://your-server.com/test" --teamspace-id "your-teamspace-id" --keycloak-client-id "your-client-id" --keycloak-client-secret "your-client-secret"
```

### Option 3: Environment File

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
# Edit .env with your actual configuration values
```

## Installation

### Option 1: Direct NPX Usage (Recommended)

You can run the MCP server directly without installation:

```bash
npx @securedevops/mcp-devops-test --token "your_token" --server-url "https://your-server.com/test" --teamspace-id "your-teamspace-id" --keycloak-client-id "your-client-id" --keycloak-client-secret "your-client-secret"
```

### Option 2: Global Installation

```bash
npm install -g @securedevops/mcp-devops-test
mcp-devops-test --token "your_token" --server-url "https://your-server.com/test" --teamspace-id "your-teamspace-id" --keycloak-client-id "your-client-id" --keycloak-client-secret "your-client-secret"
```

### Option 3: Local Development

```bash
git clone https://github.com/securedevops/mcp-devops-test.git
cd mcp-devops-test
npm install
npm run setup  # Interactive configuration setup
npm start      # Start the MCP server
```

## Use with Claude Desktop

### Option 1: NPX (Recommended)

Add the following to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "devops-test": {
      "command": "npx",
      "args": [
        "@securedevops/mcp-devops-test",
        "--token", "your_token_here",
        "--server-url", "https://your-server.com/test",
        "--teamspace-id", "your_teamspace_id",
        "--keycloak-client-id", "your_client_id",
        "--keycloak-client-secret", "your_client_secret"
      ]
    }
  }
}
```

### Option 2: Environment Variables with NPX

```json
{
  "mcpServers": {
    "devops-test": {
      "command": "npx",
      "args": ["@securedevops/mcp-devops-test"],
      "env": {
        "TEST_ACCESS_TOKEN": "your_token_here",
        "TEST_SERVER_URL": "https://your-server.com/test",
        "TEST_TEAMSPACE_ID": "your_teamspace_id",
        "KEYCLOAK_CLIENT_ID": "your_client_id",
        "KEYCLOAK_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

### Option 3: Local Installation

Add the following to your Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "devops-test": {
      "command": "node",
      "args": ["/path/to/mcp-devops-test/src/lib/server.js"],
      "env": {
        "TEST_ACCESS_TOKEN": "your_token_here",
        "TEST_SERVER_URL": "https://your-server.com/test",
        "TEST_TEAMSPACE_ID": "your_teamspace_id",
        "KEYCLOAK_CLIENT_ID": "your_client_id",
        "KEYCLOAK_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Or with command line arguments:

```json
{
  "mcpServers": {
    "devops-test": {
      "command": "node",
      "args": [
        "/path/to/mcp-devops-test/src/lib/server.js",
        "--token", "your_token_here",
        "--server-url", "https://your-server.com/test",
        "--teamspace-id", "your_teamspace_id",
        "--keycloak-client-id", "your_client_id",
        "--keycloak-client-secret", "your_client_secret"
      ]
    }
  }
}
```
## Usage

The MCP DevOps Test server provides the following tools for interacting with DevOps Test:

### Available Tools

#### 1. `get_projects`
**Purpose**: Retrieves all projects from the Test system
**Parameters**: None
**Usage**: Use this to get a list of all available projects in your Test instance. This is typically the first step to understand what projects you can work with for test execution.

#### 2. `list_tests`
**Purpose**: Retrieves tests from a specific project with optional test type filtering
**Parameters**:
- `projectId` (string): The ID of the project to retrieve tests from
- `testType` (string, optional): Optional test type filter (e.g., EXT_TEST_SUITE, EXT_TEST_SCPT, EXT_TEST_LOADP, EXT_TEST_STUB, etc.)
- `branch` (string, optional): Branch to use for retrieving tests (default: main)
**Usage**: Once you have a project ID, use this to see all tests within that project. You can filter by specific test types if needed.

#### 3. `execute_test`
**Purpose**: Execute a test in a specific project by test name
**Parameters**:
- `projectId` (string): The ID of the project containing the test
- `testName` (string): The name of the test to execute
- `browserName` (string, optional): Browser to use for execution (default: edge)
- `revision` (string, optional): Revision to use (default: main)
**Usage**: Execute a specific test within a project. Tests typically take 60-180 seconds to complete.
**Important**: After execution, wait at least 60 seconds before checking results, then use progressive back-off for status checks.

#### 4. `get_test_results`
**Purpose**: Get comprehensive test execution results and report data
**Parameters**:
- `projectId` (string): The ID of the project containing the test
- `resultId` (string): The result ID from the test execution
- `executionId` (string, optional): Optional execution ID for additional context
**Usage**: Monitor test execution progress and retrieve detailed results. Use progressive polling if status is RUNNING: 30s → 45s → 60s → 90s between checks.

#### 5. `get_test_log_results`
**Purpose**: Download and analyze test log results from the zip archive
**Parameters**:
- `projectId` (string): The ID of the project containing the test
- `downloadId` (string): The download ID for the result archive (from test execution results)
**Usage**: Download detailed test logs and artifacts from completed test executions for further analysis and debugging.