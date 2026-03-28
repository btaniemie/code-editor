package com.codereview;

import com.google.gson.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

/**
 * Makes outbound HTTPS calls to the Google Gemini API for two purposes:
 *   1. review() — structured code review returning a JSON array of comments
 *   2. chat()   — conversational response to an @ai mention in the room chat
 *
 * Networking context: both methods open a secondary TCP connection from the
 * server to generativelanguage.googleapis.com:443 using Java's built-in
 * java.net.http.HttpClient.  These HTTPS calls run on background threads so
 * they never block the WebSocket server's I/O threads.
 */
public class GeminiClient {

    private static final String API_URL_TEMPLATE =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%s";

    private static final int TIMEOUT_SECONDS = 30;

    // Maximum number of recent chat messages included in the @ai prompt.
    // Keeps the context window manageable without losing recent conversation.
    private static final int CHAT_CONTEXT_MESSAGES = 15;

    private final String     apiKey;
    private final HttpClient httpClient;
    private final Gson       gson = new Gson();

    public GeminiClient(String apiKey) {
        this.apiKey = apiKey;
        // One HttpClient instance reused across all requests.
        // Internally this manages a connection pool over TCP/TLS.
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .build();
    }

    // -------------------------------------------------------------------------
    // Code review
    // -------------------------------------------------------------------------

    /**
     * Sends the code document to Gemini and returns parsed AI comments.
     *
     * @param document  full text of the shared code document
     * @param language  language label ("python", "java", "javascript")
     * @return JsonArray of objects: { "line": int, "text": str, "severity": str, "category": str }
     * @throws Exception on HTTP error, timeout, or malformed response
     */
    public JsonArray review(String document, String language) throws Exception {
        String requestJson = buildReviewRequestBody(document, language);
        String url = String.format(API_URL_TEMPLATE, apiKey);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestJson))
            .build();

        System.out.println("[GeminiClient] Opening outbound HTTPS connection to Gemini API for review...");
        HttpResponse<String> response = httpClient.send(
            request,
            HttpResponse.BodyHandlers.ofString()
        );
        System.out.println("[GeminiClient] Gemini review responded with HTTP " + response.statusCode());

        if (response.statusCode() != 200) {
            throw new RuntimeException(
                "Gemini API returned HTTP " + response.statusCode() + ": " + response.body()
            );
        }

        return parseJsonArrayResponse(response.body());
    }

    // -------------------------------------------------------------------------
    // AI chat
    // -------------------------------------------------------------------------

    /**
     * Responds conversationally to an @ai mention in the room chat.
     *
     * The prompt gives Gemini full context: the current code, any existing
     * review comments, and the recent chat history, so its reply can reference
     * specific lines or earlier discussion.
     *
     * @param document    full text of the current shared document
     * @param language    language label for the document
     * @param comments    current AI review comments in the room
     * @param chatHistory full chat history stored in the room
     * @param userMessage the raw message text that contained the @ai mention
     * @return plain text response string
     * @throws Exception on HTTP error, timeout, or malformed response
     */
    public String chat(String document,
                       String language,
                       List<JsonObject> comments,
                       List<JsonObject> chatHistory,
                       String userMessage) throws Exception {

        String requestJson = buildChatRequestBody(document, language, comments, chatHistory, userMessage);
        String url = String.format(API_URL_TEMPLATE, apiKey);

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestJson))
            .build();

        System.out.println("[GeminiClient] Opening outbound HTTPS connection to Gemini API for chat...");
        HttpResponse<String> response = httpClient.send(
            request,
            HttpResponse.BodyHandlers.ofString()
        );
        System.out.println("[GeminiClient] Gemini chat responded with HTTP " + response.statusCode());

        if (response.statusCode() != 200) {
            throw new RuntimeException(
                "Gemini API returned HTTP " + response.statusCode() + ": " + response.body()
            );
        }

        return parsePlainTextResponse(response.body());
    }

    // -------------------------------------------------------------------------
    // Request builders
    // -------------------------------------------------------------------------

    private String buildReviewRequestBody(String document, String language) {
        String prompt = buildReviewPrompt(document, language);

        JsonObject part = new JsonObject();
        part.addProperty("text", prompt);

        JsonArray parts = new JsonArray();
        parts.add(part);

        JsonObject content = new JsonObject();
        content.add("parts", parts);

        JsonArray contents = new JsonArray();
        contents.add(content);

        JsonObject generationConfig = new JsonObject();
        generationConfig.addProperty("temperature", 0.1);
        generationConfig.addProperty("maxOutputTokens", 2048);

        JsonObject body = new JsonObject();
        body.add("contents", contents);
        body.add("generationConfig", generationConfig);

        return gson.toJson(body);
    }

    private String buildChatRequestBody(String document,
                                        String language,
                                        List<JsonObject> comments,
                                        List<JsonObject> chatHistory,
                                        String userMessage) {
        String prompt = buildChatPrompt(document, language, comments, chatHistory, userMessage);

        JsonObject part = new JsonObject();
        part.addProperty("text", prompt);

        JsonArray parts = new JsonArray();
        parts.add(part);

        JsonObject content = new JsonObject();
        content.add("parts", parts);

        JsonArray contents = new JsonArray();
        contents.add(content);

        JsonObject generationConfig = new JsonObject();
        generationConfig.addProperty("temperature", 0.4);
        generationConfig.addProperty("maxOutputTokens", 512);

        JsonObject body = new JsonObject();
        body.add("contents", contents);
        body.add("generationConfig", generationConfig);

        return gson.toJson(body);
    }

    // -------------------------------------------------------------------------
    // Prompt builders
    // -------------------------------------------------------------------------

    private String buildReviewPrompt(String document, String language) {
        return "You are a code reviewer. Review the following " + language + " code.\n"
            + "Return ONLY a JSON array. No markdown, no code fences, no explanation.\n"
            + "Each element must have exactly these fields:\n"
            + "  \"line\": integer — 1-based line number the comment applies to\n"
            + "  \"text\": string  — clear, concise review comment\n"
            + "  \"severity\": one of \"info\", \"warning\", \"critical\"\n"
            + "  \"category\": one of \"bug\", \"style\", \"performance\", \"security\"\n\n"
            + "If there is nothing to say, return an empty array: []\n"
            + "Limit to the 10 most important comments.\n\n"
            + "Code:\n"
            + document;
    }

    /**
     * Builds the context-aware prompt for @ai chat responses.
     *
     * Includes: current code, existing review comments, and the most recent
     * chat messages so the AI can reference prior discussion and specific lines.
     */
    private String buildChatPrompt(String document,
                                   String language,
                                   List<JsonObject> comments,
                                   List<JsonObject> chatHistory,
                                   String userMessage) {
        StringBuilder sb = new StringBuilder();

        sb.append("You are an AI assistant participating in a collaborative code review session.\n");
        sb.append("Be concise and helpful. Reference specific line numbers when relevant.\n");
        sb.append("Do not use markdown formatting — respond in plain text only.\n\n");

        // Current code context
        sb.append("=== Current ").append(language).append(" code ===\n");
        sb.append(document).append("\n\n");

        // Existing review comments
        if (!comments.isEmpty()) {
            sb.append("=== Review comments so far ===\n");
            for (JsonObject c : comments) {
                sb.append("Line ").append(c.get("line").getAsInt())
                  .append(" [").append(c.get("severity").getAsString()).append("/")
                  .append(c.get("category").getAsString()).append("]: ")
                  .append(c.get("text").getAsString()).append("\n");
            }
            sb.append("\n");
        }

        // Recent chat history — take the last N messages for context
        int start = Math.max(0, chatHistory.size() - CHAT_CONTEXT_MESSAGES);
        List<JsonObject> recentChat = chatHistory.subList(start, chatHistory.size());

        if (!recentChat.isEmpty()) {
            sb.append("=== Recent conversation ===\n");
            for (JsonObject msg : recentChat) {
                String uid  = msg.get("userId").getAsString();
                String text = msg.get("text").getAsString();
                // Skip system join/leave messages to reduce noise
                if ("system".equals(uid)) continue;
                String label = "ai".equals(uid) ? "AI" : uid;
                sb.append("[").append(label).append("]: ").append(text).append("\n");
            }
            sb.append("\n");
        }

        // The actual question — strip the @ai trigger so Gemini sees a clean question
        String question = userMessage.replaceAll("(?i)@ai\\s*", "").trim();
        if (question.isEmpty()) question = "What do you think about this code?";

        sb.append("=== Question ===\n");
        sb.append(question).append("\n");

        return sb.toString();
    }

    // -------------------------------------------------------------------------
    // Response parsers
    // -------------------------------------------------------------------------

    /**
     * Parses the Gemini response envelope and extracts the content as a JsonArray.
     * Used by review().
     */
    private JsonArray parseJsonArrayResponse(String responseBody) {
        String text = extractTextFromResponse(responseBody);
        text = stripMarkdownFences(text);
        return JsonParser.parseString(text).getAsJsonArray();
    }

    /**
     * Parses the Gemini response envelope and extracts the content as plain text.
     * Used by chat().
     */
    private String parsePlainTextResponse(String responseBody) {
        return extractTextFromResponse(responseBody);
    }

    /**
     * Extracts the text content from the Gemini response envelope:
     * { "candidates": [ { "content": { "parts": [ { "text": "..." } ] } } ] }
     */
    private String extractTextFromResponse(String responseBody) {
        JsonObject responseObj = JsonParser.parseString(responseBody).getAsJsonObject();
        JsonArray candidates = responseObj.getAsJsonArray("candidates");

        if (candidates == null || candidates.size() == 0) {
            throw new RuntimeException("Gemini API returned no candidates");
        }

        return candidates.get(0)
            .getAsJsonObject()
            .getAsJsonObject("content")
            .getAsJsonArray("parts")
            .get(0)
            .getAsJsonObject()
            .get("text")
            .getAsString()
            .trim();
    }

    /**
     * Strips ```json ... ``` or ``` ... ``` wrappers if the model adds them.
     */
    private String stripMarkdownFences(String text) {
        if (text.startsWith("```")) {
            int firstNewline = text.indexOf('\n');
            int lastFence    = text.lastIndexOf("```");
            if (firstNewline >= 0 && lastFence > firstNewline) {
                return text.substring(firstNewline + 1, lastFence).trim();
            }
        }
        return text;
    }
}
