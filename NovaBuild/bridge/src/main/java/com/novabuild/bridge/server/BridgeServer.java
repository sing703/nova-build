package com.novabuild.bridge.server;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.novabuild.bridge.Console;
import com.novabuild.bridge.WorkspaceManager;
import com.novabuild.bridge.tools.ToolRegistry;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

public class BridgeServer extends WebSocketServer {
    private static final Gson GSON = new Gson();
    private final WorkspaceManager workspace;
    private final ToolRegistry tools;
    private final PreviewServer previewServer;
    private final Set<WebSocket> clients = ConcurrentHashMap.newKeySet();

    public BridgeServer(int port, WorkspaceManager workspace, PreviewServer previewServer) {
        super(new InetSocketAddress("127.0.0.1", port));
        this.workspace = workspace;
        this.previewServer = previewServer;
        this.tools = new ToolRegistry(workspace, previewServer);
    }

    @Override
    public void onStart() {
        Console.info("ready (" + tools.listTools().size() + " tools)");
        Console.info("ready " + tools.listTools().size() + " tools available");
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        clients.add(conn);
        Console.log("extension connected (" + conn.getRemoteSocketAddress().getAddress().getHostAddress()
                + ") [" + clients.size() + " client(s)]");

        JsonObject hello = new JsonObject();
        hello.addProperty("type", "bridge_ready");
        hello.addProperty("version", "1.1.0");
        hello.addProperty("previewPort", previewServer.getPort());
        hello.addProperty("previewBase", "http://127.0.0.1:" + previewServer.getPort());
        hello.add("tools", GSON.toJsonTree(tools.listTools()));
        conn.send(GSON.toJson(hello));
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        clients.remove(conn);
        Console.dim("client disconnected [" + clients.size() + " client(s)]");
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            JsonObject req = GSON.fromJson(message, JsonObject.class);
            String type = req.has("type") ? req.get("type").getAsString() : "";

            if ("ping".equals(type)) {
                JsonObject pong = new JsonObject();
                pong.addProperty("type", "pong");
                conn.send(GSON.toJson(pong));
                return;
            }

            if ("list_tools".equals(type)) {
                JsonObject res = new JsonObject();
                res.addProperty("type", "tools_list");
                res.add("tools", GSON.toJsonTree(tools.listTools()));
                conn.send(GSON.toJson(res));
                return;
            }

            if ("tool_call".equals(type)) {
                String tool = req.get("tool").getAsString();
                JsonObject args = req.has("args") ? req.getAsJsonObject("args") : new JsonObject();
                String requestId = req.has("requestId") ? req.get("requestId").getAsString() : "";

                Map<String, Object> result = tools.execute(tool, args);

                JsonObject res = new JsonObject();
                res.addProperty("type", "tool_result");
                res.addProperty("requestId", requestId);
                res.addProperty("tool", tool);
                res.add("result", GSON.toJsonTree(result));
                conn.send(GSON.toJson(res));

                if (result != null && Boolean.TRUE.equals(result.get("success"))) {
                    JsonObject activity = new JsonObject();
                    activity.addProperty("type", "tool_activity");
                    activity.addProperty("tool", tool);
                    activity.add("args", args);
                    activity.add("result", GSON.toJsonTree(result));
                    broadcast(GSON.toJson(activity));
                }
                return;
            }

            if ("broadcast".equals(type)) {
                broadcastExcept(conn, message);
                return;
            }

            JsonObject err = new JsonObject();
            err.addProperty("type", "error");
            err.addProperty("message", "Unknown message type: " + type);
            conn.send(GSON.toJson(err));
        } catch (Exception e) {
            JsonObject err = new JsonObject();
            err.addProperty("type", "error");
            err.addProperty("message", e.getMessage());
            conn.send(GSON.toJson(err));
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        Console.warn("websocket error: " + ex.getMessage());
    }

    public void broadcast(String message) {
        for (WebSocket client : clients) {
            client.send(message);
        }
    }

    private void broadcastExcept(WebSocket sender, String message) {
        for (WebSocket client : clients) {
            if (client != sender) {
                client.send(message);
            }
        }
    }
}
