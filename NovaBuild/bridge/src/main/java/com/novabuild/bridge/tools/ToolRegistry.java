package com.novabuild.bridge.tools;

import com.google.gson.JsonObject;
import com.novabuild.bridge.WorkspaceManager;
import com.novabuild.bridge.server.PreviewServer;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class ToolRegistry {
    private final WorkspaceManager workspace;
    private final PreviewServer previewServer;

    public ToolRegistry(WorkspaceManager workspace, PreviewServer previewServer) {
        this.workspace = workspace;
        this.previewServer = previewServer;
    }

    public List<Map<String, Object>> listTools() {
        List<Map<String, Object>> tools = new ArrayList<Map<String, Object>>();

        tools.add(tool("list_projects", "List all NovaBuild projects", params()));
        tools.add(tool("create_project", "Create a new web or game project", param("name", "string", "type", "web|game")));
        tools.add(tool("read_file", "Read a file from a project", param("projectId", "string", "path", "string")));
        tools.add(tool("write_file", "Write a file to a project", param("projectId", "string", "path", "string", "content", "string")));
        tools.add(tool("list_files", "List all files in a project", param("projectId", "string")));
        tools.add(tool("get_project_structure", "Get project architecture: files, types, and metadata", param("projectId", "string")));
        tools.add(tool("delete_file", "Delete a file from a project", param("projectId", "string", "path", "string")));
        tools.add(tool("run_preview", "Get live preview URL to play project before publishing", param("projectId", "string")));
        tools.add(tool("publish_project", "Publish project locally with safe preview links", param("projectId", "string", "slug", "string (optional)")));
        tools.add(tool("publish_github_pages", "Deploy to GitHub Pages for Roblox-safe github.io link", param("projectId", "string", "slug", "string (optional)")));
        tools.add(tool("capture_preview", "Request extension to capture preview screenshot", param("projectId", "string (optional)", "url", "string (optional)")));
        tools.add(tool("github_status", "Check GitHub connection status", params()));
        tools.add(tool("github_connect", "Save GitHub token and username", param("token", "string", "username", "string")));
        tools.add(tool("github_push", "Push project files to a GitHub repo", param("projectId", "string", "repo", "string", "commitMessage", "string")));
        tools.add(tool("get_workspace_info", "Get NovaBuild workspace paths and config", params()));

        return tools;
    }

    public Map<String, Object> execute(String name, JsonObject args) {
        try {
            if ("list_projects".equals(name)) {
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("projects", workspace.listProjects());
                return ok(data);
            }
            if ("create_project".equals(name)) {
                String projectName = arg(args, "name", "Untitled");
                String type = arg(args, "type", "web");
                Map<String, Object> created = workspace.createProject(projectName, type);
                created.put("previewUrl", previewServer.playUrl(String.valueOf(created.get("id"))));
                return ok(created);
            }
            if ("read_file".equals(name)) {
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("content", workspace.readProjectFile(arg(args, "projectId", ""), arg(args, "path", "index.html")));
                data.put("path", arg(args, "path", "index.html"));
                data.put("projectId", arg(args, "projectId", ""));
                return ok(data);
            }
            if ("write_file".equals(name)) {
                String projectId = arg(args, "projectId", "");
                String path = arg(args, "path", "index.html");
                String content = arg(args, "content", "");
                workspace.writeProjectFile(projectId, path, content);
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("written", true);
                data.put("projectId", projectId);
                data.put("path", path);
                data.put("previewUrl", previewServer.playUrl(projectId));
                data.put("lines", content.split("\n", -1).length);
                return ok(data);
            }
            if ("list_files".equals(name)) {
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("files", workspace.listProjectFiles(arg(args, "projectId", "")));
                return ok(data);
            }
            if ("get_project_structure".equals(name)) {
                return ok(workspace.getProjectStructure(arg(args, "projectId", "")));
            }
            if ("delete_file".equals(name)) {
                String projectId = arg(args, "projectId", "");
                String path = arg(args, "path", "");
                Path file = workspace.getProjectsDir().resolve(projectId).resolve(path).normalize();
                Path root = workspace.getProjectsDir().resolve(projectId).normalize();
                if (!file.startsWith(root)) {
                    throw new IOException("Invalid path");
                }
                Files.deleteIfExists(file);
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("deleted", true);
                data.put("path", path);
                return ok(data);
            }
            if ("run_preview".equals(name)) {
                String projectId = arg(args, "projectId", "");
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("projectId", projectId);
                data.put("previewUrl", previewServer.playUrl(projectId));
                data.put("message", "Open previewUrl in browser to play before publishing.");
                return ok(data);
            }
            if ("publish_project".equals(name)) {
                String projectId = arg(args, "projectId", "");
                String slug = arg(args, "slug", null);
                if (slug != null && slug.isEmpty()) slug = null;
                String previewUrl = previewServer.publishedUrl(slug != null ? slugify(slug) : slugify(projectId));
                String playUrl = previewServer.playUrl(projectId);
                return ok(workspace.publishProject(projectId, slug, previewUrl, playUrl));
            }
            if ("publish_github_pages".equals(name)) {
                return ok(publishGithubPages(arg(args, "projectId", ""), arg(args, "slug", null)));
            }
            if ("capture_preview".equals(name)) {
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("action", "capture_request");
                data.put("projectId", arg(args, "projectId", ""));
                String url = arg(args, "url", "");
                if (url.isEmpty() && !arg(args, "projectId", "").isEmpty()) {
                    url = previewServer.playUrl(arg(args, "projectId", ""));
                }
                data.put("url", url);
                return ok(data);
            }
            if ("github_status".equals(name)) {
                Map<String, Object> config = workspace.getConfig();
                boolean connected = config.get("githubToken") != null && !isBlank(String.valueOf(config.get("githubToken")));
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("connected", connected);
                data.put("username", String.valueOf(config.containsKey("githubUsername") ? config.get("githubUsername") : ""));
                return ok(data);
            }
            if ("github_connect".equals(name)) {
                Map<String, Object> updates = new HashMap<String, Object>();
                updates.put("githubToken", arg(args, "token", ""));
                updates.put("githubUsername", arg(args, "username", ""));
                workspace.updateConfig(updates);
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("connected", true);
                return ok(data);
            }
            if ("github_push".equals(name)) {
                return ok(githubPush(arg(args, "projectId", ""), arg(args, "repo", ""), arg(args, "commitMessage", "NovaBuild update")));
            }
            if ("get_workspace_info".equals(name)) {
                Map<String, Object> data = new HashMap<String, Object>();
                data.put("projectsPath", workspace.getProjectsDir().toString());
                data.put("publishedPath", workspace.getPublishedDir().toString());
                data.put("previewBase", "http://127.0.0.1:" + previewServer.getPort());
                data.put("config", workspace.getConfig());
                return ok(data);
            }
            return error("Unknown tool: " + name);
        } catch (Exception e) {
            return error(e.getMessage());
        }
    }

    private Map<String, Object> publishGithubPages(String projectId, String customSlug) throws Exception {
        Map<String, Object> config = workspace.getConfig();
        String token = String.valueOf(config.getOrDefault("githubToken", ""));
        String username = String.valueOf(config.getOrDefault("githubUsername", ""));
        if (isBlank(token) || isBlank(username)) {
            throw new IOException("GitHub not connected. Use github_connect first.");
        }

        Path projectDir = workspace.getProjectsDir().resolve(projectId);
        if (!Files.exists(projectDir)) {
            throw new IOException("Project not found");
        }

        String slug = customSlug != null && !customSlug.trim().isEmpty() ? slugify(customSlug) : slugify(projectId);
        String repoName = "novabuild-" + slug;

        createRepoIfNeeded(token, username, repoName);

        List<Path> filesToPush = new ArrayList<Path>();
        collectFiles(projectDir, projectDir, filesToPush);

        for (Path file : filesToPush) {
            String relative = projectDir.relativize(file).toString().replace('\\', '/');
            pushFileToRepo(token, username, repoName, relative, Files.readAllBytes(file));
        }

        enableGithubPages(token, username, repoName);

        String robloxSafeUrl = "https://" + username + ".github.io/" + repoName + "/";
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("deployed", true);
        result.put("repo", username + "/" + repoName);
        result.put("robloxSafeUrl", robloxSafeUrl);
        result.put("previewUrl", robloxSafeUrl);
        result.put("note", "This github.io link is Roblox-approved. Use it in Roblox games.");
        return result;
    }

    private void createRepoIfNeeded(String token, String owner, String repoName) throws IOException {
        String apiUrl = "https://api.github.com/user/repos";
        String body = "{\"name\":\"" + repoName + "\",\"public\":true,\"auto_init\":true}";
        int code = githubRequest(token, apiUrl, "POST", body);
        if (code != 201 && code != 422) {
            throw new IOException("Failed to create repo (HTTP " + code + ")");
        }
    }

    private void collectFiles(Path root, Path dir, List<Path> out) throws IOException {
        java.nio.file.DirectoryStream<Path> stream = Files.newDirectoryStream(dir);
        try {
            for (Path entry : stream) {
                if (Files.isDirectory(entry)) {
                    collectFiles(root, entry, out);
                } else {
                    String relative = root.relativize(entry).toString().replace('\\', '/');
                    if (!"project.json".equals(relative) && !"publish.json".equals(relative)) {
                        out.add(entry);
                    }
                }
            }
        } finally {
            stream.close();
        }
    }

    private void pushFileToRepo(String token, String owner, String repo, String path, byte[] bytes) throws IOException {
        String encoded = Base64.getEncoder().encodeToString(bytes);
        String apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/contents/" + path;
        String body = "{\"message\":\"NovaBuild deploy " + path + "\",\"content\":\"" + encoded + "\"}";

        int getCode = githubRequest(token, apiUrl, "GET", null);
        if (getCode == 200) {
            body = "{\"message\":\"NovaBuild update " + path + "\",\"content\":\"" + encoded + "\",\"sha\":\"existing\"}";
        }
        githubRequest(token, apiUrl, "PUT", body);
    }

    private void enableGithubPages(String token, String owner, String repo) throws IOException {
        String apiUrl = "https://api.github.com/repos/" + owner + "/" + repo + "/pages";
        String body = "{\"source\":{\"branch\":\"main\",\"path\":\"/\"}}";
        githubRequest(token, apiUrl, "POST", body);
    }

    private int githubRequest(String token, String apiUrl, String method, String body) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl).openConnection();
        conn.setRequestMethod(method);
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("Content-Type", "application/json");
        if (body != null) {
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.flush();
            os.close();
        }
        int code = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(
                code >= 400 ? conn.getErrorStream() : conn.getInputStream(), StandardCharsets.UTF_8));
        while (reader.readLine() != null) { /* drain */ }
        reader.close();
        return code;
    }

    private Map<String, Object> githubPush(String projectId, String repo, String message) throws Exception {
        Map<String, Object> config = workspace.getConfig();
        String token = String.valueOf(config.containsKey("githubToken") ? config.get("githubToken") : "");
        if (isBlank(token)) {
            throw new IOException("GitHub not connected. Use github_connect first.");
        }

        Path projectDir = workspace.getProjectsDir().resolve(projectId);
        if (!Files.exists(projectDir)) {
            throw new IOException("Project not found");
        }

        String[] parts = repo.replace("https://github.com/", "").split("/");
        if (parts.length < 2) {
            throw new IOException("Invalid repo format. Use owner/repo");
        }
        String owner = parts[0];
        String repoName = parts[1];

        byte[] bytes = Files.readAllBytes(projectDir.resolve("index.html"));
        String content = new String(bytes, StandardCharsets.UTF_8);
        String encoded = Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8));

        String apiUrl = "https://api.github.com/repos/" + owner + "/" + repoName + "/contents/index.html";
        String body = "{\"message\":\"" + escapeJson(message) + "\",\"content\":\"" + encoded + "\"}";

        HttpURLConnection conn = (HttpURLConnection) new URL(apiUrl).openConnection();
        conn.setRequestMethod("PUT");
        conn.setRequestProperty("Authorization", "Bearer " + token);
        conn.setRequestProperty("Accept", "application/vnd.github+json");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setDoOutput(true);
        OutputStream os = conn.getOutputStream();
        os.write(body.getBytes(StandardCharsets.UTF_8));
        os.flush();
        os.close();

        int code = conn.getResponseCode();
        BufferedReader reader = new BufferedReader(new InputStreamReader(
                code >= 400 ? conn.getErrorStream() : conn.getInputStream(), StandardCharsets.UTF_8));
        StringBuilder response = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            response.append(line);
        }
        reader.close();

        if (code >= 400) {
            throw new IOException("GitHub push failed: " + response.toString());
        }

        Map<String, Object> result = new HashMap<String, Object>();
        result.put("pushed", true);
        result.put("repo", owner + "/" + repoName);
        result.put("url", "https://github.com/" + owner + "/" + repoName);
        result.put("robloxSafeUrl", "https://" + owner + ".github.io/" + repoName + "/");
        return result;
    }

    private static String slugify(String input) {
        return input.toLowerCase()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-|-$", "");
    }

    private static Map<String, Object> tool(String name, String description, Map<String, String> params) {
        Map<String, Object> tool = new LinkedHashMap<String, Object>();
        tool.put("name", name);
        tool.put("description", description);
        tool.put("parameters", params);
        return tool;
    }

    private static Map<String, String> params() {
        return Collections.emptyMap();
    }

    private static Map<String, String> param(String... kv) {
        Map<String, String> m = new LinkedHashMap<String, String>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }

    private static Map<String, Object> ok(Object data) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", true);
        result.put("data", data);
        return result;
    }

    private static Map<String, Object> error(String message) {
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put("success", false);
        result.put("error", message);
        return result;
    }

    private static String arg(JsonObject args, String key, String defaultValue) {
        if (args != null && args.has(key) && !args.get(key).isJsonNull()) {
            return args.get(key).getAsString();
        }
        return defaultValue;
    }

    private static String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
