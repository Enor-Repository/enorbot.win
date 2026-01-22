# Story 6.4: Receipt Data Parsing & Validation

Status: review

## Story

As a **developer**,
I want **receipt data parsed and validated using Zod schemas**,
so that **only valid receipt data is stored**.

## Acceptance Criteria

1. Given extracted text from a PDF, when `parseReceiptText()` is called, then it extracts: valor, dataHora, tipo, identificador (EndToEnd), recebedor, pagador

2. Given the PIX receipt contains "Valor: R$ 300.000,00", when the valor is parsed, then it is converted to centavos: 30000000

3. Given the PIX receipt contains "Data/Hora 19/01/2026 17:10:23", when the dataHora is parsed, then it is converted to ISO date string

4. Given parsed receipt data is provided, when `ReceiptDataSchema.safeParse()` is called, then it validates all required fields (valor, dataHora, identificador, recebedor.nome, recebedor.cpfCnpj, pagador.nome, pagador.cpfCnpj)

5. Given validation fails, when required fields are missing, then it returns the validation errors for logging

## Tasks / Subtasks

- [x] Task 1: Define ReceiptData Zod schema (AC: 4)
  - [x] 1.1 Create `src/types/receipt.ts` with Zod schema
  - [x] 1.2 Define valor as number (centavos)
  - [x] 1.3 Define dataHora as ISO string
  - [x] 1.4 Define identificador (EndToEnd ID) as string
  - [x] 1.5 Define recebedor as object with nome and cpfCnpj
  - [x] 1.6 Define pagador as object with nome and cpfCnpj
  - [x] 1.7 Export both schema and inferred TypeScript type

- [x] Task 2: Implement valor parsing (AC: 2)
  - [x] 2.1 Create `parseValor()` function in `src/services/receiptParser.ts`
  - [x] 2.2 Handle Brazilian format: "R$ 300.000,00" → 30000000 centavos
  - [x] 2.3 Handle variations: "R$300.000,00", "R$ 300,00", etc.
  - [x] 2.4 Write unit tests for various valor formats

- [x] Task 3: Implement dataHora parsing (AC: 3)
  - [x] 3.1 Create `parseDataHora()` function
  - [x] 3.2 Parse "19/01/2026 17:10:23" → ISO string
  - [x] 3.3 Handle date-only format: "19/01/2026"
  - [x] 3.4 Write unit tests for date parsing

- [x] Task 4: Implement full text parser (AC: 1)
  - [x] 4.1 Create `parseReceiptText()` function
  - [x] 4.2 Use regex patterns to extract each field from raw text
  - [x] 4.3 Extract EndToEnd ID (UUID pattern)
  - [x] 4.4 Extract recebedor nome and CNPJ/CPF
  - [x] 4.5 Extract pagador nome and CNPJ/CPF
  - [x] 4.6 Write unit tests with sample PDF text

- [x] Task 5: Implement validation with error reporting (AC: 4, 5)
  - [x] 5.1 Create `validateReceiptData()` wrapper function
  - [x] 5.2 Use ReceiptDataSchema.safeParse()
  - [x] 5.3 Return Result type with validation errors on failure
  - [x] 5.4 Write unit tests for valid data
  - [x] 5.5 Write unit tests for missing/invalid fields

## Dev Notes

### Architecture Patterns
- Follow Result<T> pattern from `src/utils/result.ts`
- Use Zod for validation (already in project dependencies)
- Services never throw - always return Result type

### Source Files to Create/Modify
- `src/types/receipt.ts` - Zod schema and types
- `src/services/receiptParser.ts` - Parsing functions
- `src/services/receiptParser.test.ts` - Unit tests

### Sample PDF Text Structure (CorpX Bank)
```
COMPROVANTE PIX

Valor: R$ 300.000,00
Data/Hora 19/01/2026 17:10:23
Tipo: Transferência INTERNA

Identificador
7c005681-9f98-4ea5-a12e-45a7a71345e2

Recebedor
IBLF CONSULTORIA
CNPJ: 36.328.973/0001-00

Pagador
ES CAPITAL
CNPJ: 45.959.199/0001-18
```

### Zod Schema Definition
```typescript
import { z } from 'zod';

export const ReceiptDataSchema = z.object({
  valor: z.number().int().positive(), // centavos
  dataHora: z.string().datetime(),
  tipo: z.string().optional(),
  identificador: z.string().uuid(),
  recebedor: z.object({
    nome: z.string().min(1),
    cpfCnpj: z.string().regex(/^\d{11}$|^\d{14}$/), // CPF or CNPJ digits only
  }),
  pagador: z.object({
    nome: z.string().min(1),
    cpfCnpj: z.string().regex(/^\d{11}$|^\d{14}$/),
  }),
});

export type ReceiptData = z.infer<typeof ReceiptDataSchema>;
```

### Valor Parsing Examples
- "R$ 300.000,00" → 30000000
- "R$ 1.234,56" → 123456
- "R$100,00" → 10000

### CPF/CNPJ Cleaning
- Input: "36.328.973/0001-00"
- Output: "36328973000100" (digits only)

### Testing Standards
- Co-located tests in `src/services/receiptParser.test.ts`
- Use sample text from actual receipts
- Test edge cases: missing fields, wrong formats

### Project Structure Notes
- Types in `src/types/receipt.ts` - shared with 6.3 and 6.5
- Parser service in `src/services/receiptParser.ts`

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-6.4]
- [Source: /Users/joaogalhardo/Downloads/ComprovanteCorpXBank.pdf - sample receipt]
- [Source: src/config.ts - existing Zod usage pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References
- All 54 receipt parser tests pass
- Tests cover: valor parsing, dataHora parsing, CPF/CNPJ cleaning, full text parsing, validation

### Completion Notes List
- ReceiptData types already created in Story 6.3 (src/types/receipt.ts)
- Created parseValor() - Brazilian currency "R$ 300.000,00" → 30000000 centavos
- Created parseDataHora() - Brazilian date "19/01/2026 17:10:23" → ISO string
- Created cleanCpfCnpj() - Removes formatting from CPF/CNPJ
- Created parseReceiptText() - Extracts all fields from PDF text using regex
- Created validateReceiptData() - Validates with Zod schema, returns errors
- Created parseAndValidateReceipt() - Convenience function combining both
- Added input guards to prevent throws from invalid input
- Date validation includes range checks for day/month/hour/minute/second
- 54 comprehensive tests cover all ACs and edge cases

### File List
- src/types/receipt.ts (already created in 6.3)
- src/services/receiptParser.ts (created)
- src/services/receiptParser.test.ts (created)

## Change Log
- 2026-01-19: Story 6.4 implemented - receipt data parsing and validation with full test coverage
