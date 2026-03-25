package com.codereview;

import com.google.gson.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * Makes outbound HTTPS calls to the Google Gemini API to perform code review.
 *
 * Networking context: this class opens a secondary TCP connection from the
 * server to generativelanguage.googleapis.com:443 using Java's built-in
 * java.net.http.HttpClient (introduced in Java 11).  This HTTPS call runs on
 * a background thread so it never blocks the WebSocket server's I/O threads.
 *
 * The API key is passed as a URL query parameter (Gemini's auth scheme).
 * Request and response bodies are JSON over HTTP/1.1 or HTTP/2 — TLS handled
 * transparently by the JDK's SSLContext.
 */
public class GeminiClient {

    // Gemini REST endpoint — API key is appended as a query parameter at call time
    private static final String API_URL_TEMPLATE =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=%s";

    private static final int TIMEOUT_SECONDS = 30;

    private final String     apiKey;
    private final HttpClient httpClient;
    private final Gson       gson = new Gson();

    public GeminiClient(String apiKey) {
        this.apiKey = apiKey;
        // One HttpClient instance reused across review requests.
        // Internally this manages a connection pool over TCP/TLS.
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .build();
    }

    /**
     * Sends the code document to Gemini and returns parsed AI comments.
     *
     * @param document  full text of the shared code document
     * @param language  language label ("python", "java", "javascript")
     * @return JsonArray of objects: { "line": int, "text": str, "severity": str, "category": str }
     * @throws Exception on HTTP error, timeout, or malformed response
     */
    public JsonArray review(String document, String language) throws Exception {
        String requestJson = buildRequestBody(document, language);
        String url = String.format(API_URL_TEMPLATE, apiKey);

        // Build the outbound HTTPS POST request to the Gemini endpoint.
        // The JDK's HttpClient handles the TCP connect + TLS handshake before
        // sending our HTTP/1.1 request over the established encrypted stream.
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofSeconds(TIMEOUT_SECONDS))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestJson))
            .build();

        System.out.println("[GeminiClient] Opening outbound HTTPS connection to Gemini API...");
        HttpResponse<String> response = httpClient.send(
            request,
            HttpResponse.BodyHandlers.ofString()
        );
        System.out.println("[GeminiClient] Gemini API responded with HTTP " + response.statusCode());

        if (response.statusCode() != 200) {
            throw new RuntimeException(
                "Gemini API returned HTTP " + response.statusCode() + ": " + response.body()
            );
        }

        return parseComments(response.body());
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Builds the Gemini generateContent request body.
     *
     * Gemini's message format wraps the prompt in:
     *   { "contents": [ { "parts": [ { "text": "..." } ] } ] }
     */
    private String buildRequestBody(String document, String language) {
        String prompt = buildPrompt(document, language);

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

    /**
     * Prompt instructs Gemini to return a raw JSON array only.
     * The "Limit to 10" guard keeps token usage predictable.
     */
    private String buildPrompt(String document, String language) {
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
     * Parses the Gemini response envelope and extracts the JSON array of comments.
     *
     * Gemini response shape:
     * {
     *   "candidates": [
     *     {
     *       "content": {
     *         "parts": [ { "text": "..." } ]
     *       }
     *     }
     *   ]
     * }
     */
    private JsonArray parseComments(String responseBody) {
        JsonObject responseObj = JsonParser.parseString(responseBody).getAsJsonObject();
        JsonArray candidates = responseObj.getAsJsonArray("candidates");

        if (candidates == null || candidates.size() == 0) {
            throw new RuntimeException("Gemini API returned no candidates");
        }

        String text = candidates.get(0)
            .getAsJsonObject()
            .getAsJsonObject("content")
            .getAsJsonArray("parts")
            .get(0)
            .getAsJsonObject()
            .get("text")
            .getAsString()
            .trim();

        // Strip markdown code fences in case Gemini ignores the "no fences" instruction
        text = stripMarkdownFences(text);

        return JsonParser.parseString(text).getAsJsonArray();
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
