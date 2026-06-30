package com.novabuild.bridge;

import com.novabuild.bridge.server.BridgeServer;
import com.novabuild.bridge.server.PreviewServer;

public class BridgeMain {
    public static void main(String[] args) throws Exception {
        int port = 17613;
        if (args.length > 0) {
            port = Integer.parseInt(args[0]);
        }

        Console.printBanner();
        Console.step(1, 4, "Checking Java runtime... OK (" + System.getProperty("java.version") + ")");
        Console.step(2, 4, "Initializing build workspace...");
        WorkspaceManager workspace = new WorkspaceManager();
        workspace.ensureReady();
        Console.step(3, 4, "Starting preview server...");
        PreviewServer previewServer = new PreviewServer(workspace, PreviewServer.DEFAULT_PORT);
        previewServer.start();
        Console.step(4, 4, "Starting bridge...");

        BridgeServer server = new BridgeServer(port, workspace, previewServer);
        server.start();

        Console.info("NovaBuild Bridge listening on ws://127.0.0.1:" + port);
        Console.info("Preview & play at http://127.0.0.1:" + PreviewServer.DEFAULT_PORT);
        Console.info("Load the extension and open your AI chat (DeepSeek recommended)");
        Console.dim("Press Ctrl+C to stop");

        Runtime.getRuntime().addShutdownHook(new Thread(new Runnable() {
            @Override
            public void run() {
                server.stop();
                previewServer.stop();
            }
        }));
        Thread.currentThread().join();
    }
}
