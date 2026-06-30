package com.novabuild.bridge.server;

import com.novabuild.bridge.Console;
import com.novabuild.bridge.WorkspaceManager;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves project previews on localhost so links are clean and Roblox-friendly
 * when combined with GitHub Pages publishing.
 */
public class PreviewServer {
    public static final int DEFAULT_PORT = 17614;

    private final WorkspaceManager workspace;
    private final int port;
    private HttpServer server;

    public PreviewServer(WorkspaceManager workspace, int port) {
        this.workspace = workspace;
        this.port = port;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/play/", new ProjectHandler());
        server.createContext("/published/", new PublishedHandler());
        server.createContext("/health", new HealthHandler());
        server.setExecutor(null);
        server.start();
        Console.info("Preview server at http://127.0.0.1:" + port);
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
    }

    public int getPort() {
        return port;
    }

    public String playUrl(String projectId) {
        return "http://127.0.0.1:" + port + "/play/" + projectId + "/";
    }

    public String publishedUrl(String slug) {
        return "http://127.0.0.1:" + port + "/published/" + slug + "/";
    }

    private class HealthHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            byte[] body = "{\"ok\":true,\"service\":\"novabuild-preview\"}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
            exchange.sendResponseHeaders(200, body.length);
            OutputStream os = exchange.getResponseBody();
            os.write(body);
            os.close();
        }
    }

    private class ProjectHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String rest = path.substring("/play/".length());
            serveFrom(workspace.getProjectsDir(), rest, exchange);
        }
    }

    private class PublishedHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            String rest = path.substring("/published/".length());
            serveFrom(workspace.getPublishedDir(), rest, exchange);
        }
    }

    private void serveFrom(Path baseDir, String rest, HttpExchange exchange) throws IOException {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("X-Frame-Options", "ALLOWALL");

        String[] parts = rest.split("/", 2);
        if (parts.length == 0 || parts[0].isEmpty()) {
            sendText(exchange, 404, "Not found");
            return;
        }

        String projectId = parts[0];
        String filePath = parts.length > 1 && !parts[1].isEmpty() ? parts[1] : "index.html";

        Path projectDir = baseDir.resolve(projectId).normalize();
        if (!projectDir.startsWith(baseDir.normalize()) || !Files.isDirectory(projectDir)) {
            sendText(exchange, 404, "Project not found");
            return;
        }

        Path file = projectDir.resolve(filePath).normalize();
        if (!file.startsWith(projectDir) || !Files.exists(file) || Files.isDirectory(file)) {
            if (Files.exists(projectDir.resolve("index.html"))) {
                file = projectDir.resolve("index.html");
            } else {
                sendText(exchange, 404, "File not found");
                return;
            }
        }

        byte[] bytes = Files.readAllBytes(file);
        String contentType = guessContentType(file.getFileName().toString());
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(200, bytes.length);
        OutputStream os = exchange.getResponseBody();
        os.write(bytes);
        os.close();
    }

    private static void sendText(HttpExchange exchange, int code, String message) throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain");
        exchange.sendResponseHeaders(code, body.length);
        OutputStream os = exchange.getResponseBody();
        os.write(body);
        os.close();
    }

    private static String guessContentType(String filename) {
        String lower = filename.toLowerCase();
        Map<String, String> types = new HashMap<String, String>();
        types.put("html", "text/html; charset=utf-8");
        types.put("htm", "text/html; charset=utf-8");
        types.put("css", "text/css; charset=utf-8");
        types.put("js", "application/javascript; charset=utf-8");
        types.put("json", "application/json; charset=utf-8");
        types.put("png", "image/png");
        types.put("jpg", "image/jpeg");
        types.put("jpeg", "image/jpeg");
        types.put("gif", "image/gif");
        types.put("svg", "image/svg+xml");
        types.put("ico", "image/x-icon");
        types.put("woff", "font/woff");
        types.put("woff2", "font/woff2");
        types.put("ttf", "font/ttf");
        types.put("mp3", "audio/mpeg");
        types.put("wav", "audio/wav");
        types.put("mp4", "video/mp4");
        types.put("webm", "video/webm");

        int dot = lower.lastIndexOf('.');
        if (dot >= 0) {
            String ext = lower.substring(dot + 1);
            if (types.containsKey(ext)) {
                return types.get(ext);
            }
        }
        return "application/octet-stream";
    }
}
