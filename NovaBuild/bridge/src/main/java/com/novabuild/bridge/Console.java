package com.novabuild.bridge;

public final class Console {
    private static final String CYAN = "\u001B[96m";
    private static final String GREEN = "\u001B[92m";
    private static final String YELLOW = "\u001B[93m";
    private static final String DIM = "\u001B[90m";
    private static final String RESET = "\u001B[0m";

    private Console() {}

    public static void printBanner() {
        System.out.println();
        System.out.println(CYAN + "=== NovaBuild Bridge ===" + RESET);
    }

    public static void step(int current, int total, String message) {
        System.out.println("[" + current + "/" + total + "] " + message);
    }

    public static void info(String message) {
        System.out.println(GREEN + message + RESET);
    }

    public static void warn(String message) {
        System.out.println(YELLOW + message + RESET);
    }

    public static void dim(String message) {
        System.out.println(DIM + message + RESET);
    }

    public static void log(String message) {
        System.out.println(message);
    }
}
