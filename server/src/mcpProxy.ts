import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  isJSONRPCRequest,
  isJSONRPCResponse,
  JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

function onClientError(error: Error) {
  console.error("Error from inspector client:", error);
}

function onServerError(error: Error) {
  if (error?.cause && JSON.stringify(error.cause).includes("ECONNREFUSED")) {
    console.error("Connection refused. Is the MCP server running?");
  } else if (error.message && error.message.includes("404")) {
    console.error("Error accessing endpoint (HTTP 404)");
  } else {
    console.error("Error from MCP server:", error);
  }
}

export default function mcpProxy({
  transportToClient,
  transportToServer,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  let reportedServerSession = false;

  transportToClient.onmessage = (message) => {
    transportToServer.send(message).catch((error) => {
      // Send error response back to client if it was a request (has id) and connection is still open
      if (isJSONRPCRequest(message) && !transportToClientClosed) {
        // Check if the error contains a JSON-RPC error response from the server
        let errorResponse: JSONRPCMessage;

        // Try to extract JSON-RPC error from error message (for HTTP 400 responses with JSON content)
        const jsonRpcErrorMatch = error.message?.match(
          /\{"jsonrpc":"2\.0".*\}/,
        );
        if (jsonRpcErrorMatch) {
          try {
            const jsonRpcError = JSON.parse(jsonRpcErrorMatch[0]);
            if (
              jsonRpcError.jsonrpc === "2.0" &&
              jsonRpcError.error &&
              jsonRpcError.id !== undefined
            ) {
              // This is a valid JSON-RPC error response from the server, forward it
              errorResponse = {
                jsonrpc: "2.0" as const,
                id: message.id,
                error: jsonRpcError.error,
              };
            } else {
              // Fallback to timeout error
              errorResponse = {
                jsonrpc: "2.0" as const,
                id: message.id,
                error: {
                  code: -32001,
                  message: error.message,
                  data: error,
                },
              };
            }
          } catch {
            // JSON parse failed, use timeout error
            errorResponse = {
              jsonrpc: "2.0" as const,
              id: message.id,
              error: {
                code: -32001,
                message: error.message,
                data: error,
              },
            };
          }
        } else {
          // No JSON-RPC error found, use timeout error (genuine transport error)
          errorResponse = {
            jsonrpc: "2.0" as const,
            id: message.id,
            error: {
              code: -32001,
              message: error.message,
              data: error,
            },
          };
        }

        transportToClient.send(errorResponse).catch(onClientError);
      }
    });
  };

  transportToServer.onmessage = (message) => {
    if (!reportedServerSession) {
      if (transportToServer.sessionId) {
        // Can only report for StreamableHttp
        console.error(
          "Proxy  <-> Server sessionId: " + transportToServer.sessionId,
        );
      }
      reportedServerSession = true;
    }
    transportToClient.send(message).catch(onClientError);
  };

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;
}
