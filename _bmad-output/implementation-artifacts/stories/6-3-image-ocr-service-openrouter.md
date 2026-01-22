# Story 6.3: Image OCR Service (OpenRouter)

Status: review

## Story

As a **developer**,
I want **a service that extracts receipt data from images using OpenRouter Claude Haiku Vision**,
so that **screenshot receipts can be processed**.

## Acceptance Criteria

1. Given an image buffer and MIME type are provided, when `extractImageReceipt()` is called, then it sends the image to OpenRouter Claude Haiku with a structured prompt and returns `{ok: true, data: ReceiptData}` on success

2. Given the OCR request completes within 10 seconds (NFR21), when Claude returns valid JSON, then the parsed receipt data is returned immediately

3. Given the OCR request exceeds 10 seconds, when the timeout triggers, then it returns `{ok: false, error: "OCR timeout"}`

4. Given Claude cannot extract receipt data from the image, when the response indicates failure, then it returns `{ok: false, error: "Could not extract receipt data"}`

5. Given the OpenRouter API key is configured via `OPENROUTER_API_KEY`, when the service initializes, then it uses the configured API key for authentication

6. Given any OCR request is made, when the request completes (success or failure), then the cost/tokens are logged for monitoring (NFR22)

## Tasks / Subtasks

- [x] Task 1: Add OpenRouter config to environment (AC: 5)
  - [x] 1.1 Add `OPENROUTER_API_KEY` to config schema in `src/config.ts`
  - [x] 1.2 Add validation for API key presence
  - [x] 1.3 Verify .env and .env.example have the key (already added)

- [x] Task 2: Create OpenRouter client service (AC: 1, 5)
  - [x] 2.1 Create `src/services/openrouter.ts`
  - [x] 2.2 Implement HTTP client for OpenRouter API
  - [x] 2.3 Use `claude-3-5-haiku-20241022` model for vision
  - [x] 2.4 Handle base64 image encoding for API request

- [x] Task 3: Implement extractImageReceipt function (AC: 1)
  - [x] 3.1 Create structured prompt for PIX receipt extraction
  - [x] 3.2 Define expected JSON output schema in prompt
  - [x] 3.3 Parse Claude's response into ReceiptData structure
  - [x] 3.4 Write unit tests with mocked API responses

- [x] Task 4: Add timeout handling (AC: 2, 3)
  - [x] 4.1 Implement 10-second timeout using Promise.race
  - [x] 4.2 Return timeout error when exceeded
  - [x] 4.3 Write unit test for timeout scenario

- [x] Task 5: Handle extraction failures (AC: 4)
  - [x] 5.1 Detect when Claude cannot extract valid data
  - [x] 5.2 Return appropriate error message
  - [x] 5.3 Write unit test for extraction failure scenario

- [x] Task 6: Implement cost/token logging (AC: 6)
  - [x] 6.1 Parse usage data from OpenRouter response
  - [x] 6.2 Log input_tokens, output_tokens, and calculated cost
  - [x] 6.3 Write unit test verifying logging occurs

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Services never throw - always return Result type
- Structured logging via `src/utils/logger.ts`

### Source Files to Create/Modify
- `src/services/openrouter.ts` - New file
- `src/services/openrouter.test.ts` - New file
- `src/config.ts` - Add OPENROUTER_API_KEY validation
- `src/types/receipt.ts` - ReceiptData type (shared with Story 6.4)

### OpenRouter API Reference
```typescript
const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'anthropic/claude-3-5-haiku-20241022',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACTION_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } }
      ]
    }]
  })
});
```

### Extraction Prompt Template
```
You are analyzing a Brazilian PIX transfer receipt. Extract the following data in JSON format:
{
  "valor": number (in centavos, e.g., R$ 300.000,00 = 30000000),
  "dataHora": "ISO date string",
  "tipo": "string (transfer type)",
  "identificador": "EndToEnd ID (UUID format)",
  "recebedor": { "nome": "string", "cpfCnpj": "string (numbers only)" },
  "pagador": { "nome": "string", "cpfCnpj": "string (numbers only)" }
}
If you cannot extract this data, respond with: {"error": "reason"}
```

### Testing Standards
- Co-located tests in `src/services/openrouter.test.ts`
- Mock fetch for API calls
- Test with sample base64 image data

### NFR References
- NFR21: Image OCR processing completes within 10 seconds or times out
- NFR22: OpenRouter API costs tracked and logged for monitoring

### Cost Tracking
- Claude Haiku 4.5 via OpenRouter: ~$0.0008/1K input, ~$0.004/1K output
- Log format: `{ model, input_tokens, output_tokens, cost_usd }`

### Project Structure Notes
- Service pattern matches existing services (binance.ts, excel.ts)
- ReceiptData type will be defined in `src/types/receipt.ts` (shared with 6.4)

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.3]
- [Source: src/services/binance.ts - service pattern]
- [Source: https://openrouter.ai/docs - API documentation]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References
- All 24 OpenRouter service tests pass
- Tests cover: successful extraction, timeout handling, extraction failures, API key config, cost logging

### Completion Notes List
- Added OPENROUTER_API_KEY to config schema with optional validation
- Added isOpenRouterConfigured() helper function
- Created ReceiptData, RawReceiptData, ReceiptParty types with Zod schemas
- Created extractImageReceipt() function with Claude Haiku Vision
- 10-second timeout via Promise.race (NFR21)
- Cost/token logging with calculated USD (NFR22)
- Structured prompt for PIX receipt JSON extraction
- Base64 image encoding for API request
- 24 comprehensive tests cover all ACs

### File List
- src/services/openrouter.ts (created)
- src/services/openrouter.test.ts (created)
- src/types/config.ts (modified)
- src/types/receipt.ts (created)

## Change Log
- 2026-01-19: Story 6.3 implemented - OpenRouter image OCR service with full test coverage
