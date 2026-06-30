package com.novabuild.bridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public class WorkspaceManager {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private final Path root;
    private final Path projectsDir;
    private final Path publishedDir;
    private final Path configFile;

    public WorkspaceManager() {
        String home = System.getProperty("user.home");
        this.root = Paths.get(home, "NovaBuild");
        this.projectsDir = root.resolve("projects");
        this.publishedDir = root.resolve("published");
        this.configFile = root.resolve("config.json");
    }

    public void ensureReady() throws IOException {
        Files.createDirectories(projectsDir);
        Files.createDirectories(publishedDir);
        if (!Files.exists(configFile)) {
            Map<String, Object> config = new LinkedHashMap<String, Object>();
            config.put("githubToken", "");
            config.put("githubUsername", "");
            config.put("defaultPublishDomain", "novabuild.local");
            config.put("createdAt", Instant.now().toString());
            writeJson(configFile, config);
        }
    }

    public Path getProjectsDir() {
        return projectsDir;
    }

    public Path getPublishedDir() {
        return publishedDir;
    }

    public Map<String, Object> getConfig() throws IOException {
        return readJson(configFile);
    }

    public void updateConfig(Map<String, Object> updates) throws IOException {
        Map<String, Object> config = getConfig();
        config.putAll(updates);
        writeJson(configFile, config);
    }

    public List<Map<String, Object>> listProjects() throws IOException {
        List<Map<String, Object>> projects = new ArrayList<Map<String, Object>>();
        if (!Files.exists(projectsDir)) {
            return projects;
        }
        DirectoryStream<Path> stream = Files.newDirectoryStream(projectsDir);
        try {
            for (Path dir : stream) {
                if (!Files.isDirectory(dir)) continue;
                Path meta = dir.resolve("project.json");
                if (Files.exists(meta)) {
                    Map<String, Object> metaMap = readJson(meta);
                    metaMap.put("id", dir.getFileName().toString());
                    projects.add(metaMap);
                }
            }
        } finally {
            stream.close();
        }
        return projects;
    }

    public Map<String, Object> createProject(String name, String type) throws IOException {
        String id = slugify(name) + "-" + UUID.randomUUID().toString().substring(0, 8);
        Path projectDir = projectsDir.resolve(id);
        Files.createDirectories(projectDir);

        Map<String, Object> meta = new LinkedHashMap<String, Object>();
        meta.put("name", name);
        meta.put("type", type);
        meta.put("createdAt", Instant.now().toString());
        meta.put("publishSlug", id);
        writeJson(projectDir.resolve("project.json"), meta);

        String starter;
        if ("game".equalsIgnoreCase(type)) {
            starter = starterGameHtml(name);
        } else {
            starter = starterWebHtml(name);
        }
        writeText(projectDir.resolve("index.html"), starter);
        writeText(projectDir.resolve("style.css"), starterCss());
        writeText(projectDir.resolve("script.js"), starterJs(type));

        meta.put("id", id);
        meta.put("path", projectDir.toString());
        return meta;
    }

    public Map<String, Object> publishProject(String projectId, String customSlug, String previewUrl, String playUrl) throws IOException {
        Path source = projectsDir.resolve(projectId);
        if (!Files.exists(source)) {
            throw new IOException("Project not found: " + projectId);
        }

        String slug;
        if (customSlug != null && !customSlug.trim().isEmpty()) {
            slug = slugify(customSlug);
        } else {
            slug = slugify(projectId);
        }

        Path target = publishedDir.resolve(slug);
        if (Files.exists(target)) {
            deleteRecursive(target);
        }
        copyRecursive(source, target);

        String resolvedPreview = previewUrl != null ? previewUrl : "http://127.0.0.1:17614/published/" + slug + "/";
        String resolvedPlay = playUrl != null ? playUrl : "http://127.0.0.1:17614/play/" + projectId + "/";

        Map<String, Object> publishMeta = new LinkedHashMap<String, Object>();
        publishMeta.put("projectId", projectId);
        publishMeta.put("slug", slug);
        publishMeta.put("previewUrl", resolvedPreview);
        publishMeta.put("playUrl", resolvedPlay);
        publishMeta.put("localPath", target.toString());
        publishMeta.put("publishedAt", Instant.now().toString());
        publishMeta.put("robloxNote", "For Roblox games, use publish_github_pages to get a github.io link (Roblox-approved domain).");
        writeJson(target.resolve("publish.json"), publishMeta);

        Map<String, Object> config = getConfig();
        String ghUser = String.valueOf(config.getOrDefault("githubUsername", ""));
        if (!ghUser.isEmpty()) {
            publishMeta.put("robloxSafeUrl", "https://" + ghUser + ".github.io/novabuild-" + slug + "/");
            publishMeta.put("robloxHint", "Run publish_github_pages to deploy this link for Roblox.");
        }

        return publishMeta;
    }

    public List<Map<String, Object>> listProjectFiles(String projectId) throws IOException {
        Path projectDir = projectsDir.resolve(projectId);
        if (!Files.exists(projectDir)) {
            throw new IOException("Project not found: " + projectId);
        }
        List<Map<String, Object>> files = new ArrayList<Map<String, Object>>();
        Files.walk(projectDir).forEach(new java.util.function.Consumer<Path>() {
            @Override
            public void accept(Path path) {
                if (Files.isDirectory(path)) return;
                try {
                    Map<String, Object> entry = new LinkedHashMap<String, Object>();
                    String relative = projectDir.relativize(path).toString().replace('\\', '/');
                    entry.put("path", relative);
                    entry.put("size", Files.size(path));
                    entry.put("type", fileType(relative));
                    files.add(entry);
                } catch (IOException ignored) {
                }
            }
        });
        return files;
    }

    public Map<String, Object> getProjectStructure(String projectId) throws IOException {
        Path projectDir = projectsDir.resolve(projectId);
        if (!Files.exists(projectDir)) {
            throw new IOException("Project not found: " + projectId);
        }
        Map<String, Object> structure = new LinkedHashMap<String, Object>();
        structure.put("projectId", projectId);
        structure.put("root", projectDir.toString());
        structure.put("files", listProjectFiles(projectId));
        if (Files.exists(projectDir.resolve("project.json"))) {
            structure.put("meta", readJson(projectDir.resolve("project.json")));
        }
        return structure;
    }

    private static String fileType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
        if (lower.endsWith(".css")) return "css";
        if (lower.endsWith(".js")) return "javascript";
        if (lower.endsWith(".json")) return "json";
        if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".svg")) return "asset";
        return "file";
    }

    public String readProjectFile(String projectId, String relativePath) throws IOException {
        Path file = resolveProjectFile(projectId, relativePath);
        return new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
    }

    public void writeProjectFile(String projectId, String relativePath, String content) throws IOException {
        Path file = resolveProjectFile(projectId, relativePath);
        Files.createDirectories(file.getParent());
        Files.write(file, content.getBytes(StandardCharsets.UTF_8));
    }

    private Path resolveProjectFile(String projectId, String relativePath) throws IOException {
        Path projectDir = projectsDir.resolve(projectId).normalize();
        Path file = projectDir.resolve(relativePath).normalize();
        if (!file.startsWith(projectDir)) {
            throw new IOException("Invalid path");
        }
        return file;
    }

    private static String slugify(String input) {
        return input.toLowerCase()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-|-$", "");
    }

    private static void copyRecursive(final Path source, final Path target) throws IOException {
        Files.walk(source).forEach(new java.util.function.Consumer<Path>() {
            @Override
            public void accept(Path path) {
                try {
                    Path dest = target.resolve(source.relativize(path));
                    if (Files.isDirectory(path)) {
                        Files.createDirectories(dest);
                    } else {
                        Files.createDirectories(dest.getParent());
                        Files.copy(path, dest, StandardCopyOption.REPLACE_EXISTING);
                    }
                } catch (IOException e) {
                    throw new RuntimeException(e);
                }
            }
        });
    }

    private static void deleteRecursive(Path path) throws IOException {
        if (!Files.exists(path)) return;
        Files.walk(path)
                .sorted(Comparator.reverseOrder())
                .forEach(new java.util.function.Consumer<Path>() {
                    @Override
                    public void accept(Path p) {
                        try {
                            Files.deleteIfExists(p);
                        } catch (IOException e) {
                            throw new RuntimeException(e);
                        }
                    }
                });
    }

    private static Map<String, Object> readJson(Path path) throws IOException {
        String json = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
        return GSON.fromJson(json, new TypeToken<Map<String, Object>>() {}.getType());
    }

    private static void writeJson(Path path, Map<String, Object> data) throws IOException {
        Files.write(path, GSON.toJson(data).getBytes(StandardCharsets.UTF_8));
    }

    private static void writeText(Path path, String content) throws IOException {
        Files.write(path, content.getBytes(StandardCharsets.UTF_8));
    }

    private static String starterWebHtml(String name) {
        return "<!DOCTYPE html>\n"
                + "<html lang=\"en\">\n"
                + "<head>\n"
                + "  <meta charset=\"UTF-8\">\n"
                + "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
                + "  <title>" + name + "</title>\n"
                + "  <link rel=\"stylesheet\" href=\"style.css\">\n"
                + "</head>\n"
                + "<body>\n"
                + "  <main class=\"hero\">\n"
                + "    <h1>" + name + "</h1>\n"
                + "    <p>Built with NovaBuild. Tell your AI what to create next.</p>\n"
                + "    <button id=\"action\">Get Started</button>\n"
                + "  </main>\n"
                + "  <script src=\"script.js\"></script>\n"
                + "</body>\n"
                + "</html>\n";
    }

    private static String starterGameHtml(String name) {
        return "<!DOCTYPE html>\n"
                + "<html lang=\"en\">\n"
                + "<head>\n"
                + "  <meta charset=\"UTF-8\">\n"
                + "  <title>" + name + " Game</title>\n"
                + "  <link rel=\"stylesheet\" href=\"style.css\">\n"
                + "</head>\n"
                + "<body>\n"
                + "  <canvas id=\"game\" width=\"640\" height=\"480\"></canvas>\n"
                + "  <p id=\"score\">Score: 0</p>\n"
                + "  <script src=\"script.js\"></script>\n"
                + "</body>\n"
                + "</html>\n";
    }

    private static String starterCss() {
        return "* { box-sizing: border-box; margin: 0; padding: 0; }\n"
                + "body {\n"
                + "  font-family: system-ui, sans-serif;\n"
                + "  background: linear-gradient(135deg, #0f172a, #1e293b);\n"
                + "  color: #f8fafc;\n"
                + "  min-height: 100vh;\n"
                + "  display: grid;\n"
                + "  place-items: center;\n"
                + "}\n"
                + ".hero { text-align: center; padding: 2rem; }\n"
                + ".hero h1 { font-size: 2.5rem; margin-bottom: 1rem; }\n"
                + ".hero p { opacity: 0.8; margin-bottom: 1.5rem; }\n"
                + "button, #action {\n"
                + "  background: #6366f1;\n"
                + "  color: white;\n"
                + "  border: none;\n"
                + "  padding: 0.75rem 1.5rem;\n"
                + "  border-radius: 999px;\n"
                + "  cursor: pointer;\n"
                + "  font-size: 1rem;\n"
                + "}\n"
                + "canvas { background: #020617; border-radius: 12px; display: block; margin: 1rem auto; }\n"
                + "#score { text-align: center; }\n";
    }

    private static String starterJs(String type) {
        if ("game".equalsIgnoreCase(type)) {
            return "const canvas = document.getElementById('game');\n"
                    + "const ctx = canvas.getContext('2d');\n"
                    + "const scoreEl = document.getElementById('score');\n"
                    + "let score = 0;\n"
                    + "let x = 50, y = 50, dx = 3, dy = 2;\n"
                    + "function loop() {\n"
                    + "  ctx.fillStyle = '#020617';\n"
                    + "  ctx.fillRect(0, 0, canvas.width, canvas.height);\n"
                    + "  ctx.fillStyle = '#22d3ee';\n"
                    + "  ctx.fillRect(x, y, 24, 24);\n"
                    + "  x += dx; y += dy;\n"
                    + "  if (x <= 0 || x >= canvas.width - 24) dx *= -1;\n"
                    + "  if (y <= 0 || y >= canvas.height - 24) dy *= -1;\n"
                    + "  requestAnimationFrame(loop);\n"
                    + "}\n"
                    + "canvas.addEventListener('click', function() {\n"
                    + "  score += 10;\n"
                    + "  scoreEl.textContent = 'Score: ' + score;\n"
                    + "});\n"
                    + "loop();\n";
        }
        return "document.getElementById('action').addEventListener('click', function() {\n"
                + "  alert('NovaBuild is ready. Ask your AI to edit this project!');\n"
                + "});\n";
    }
}
