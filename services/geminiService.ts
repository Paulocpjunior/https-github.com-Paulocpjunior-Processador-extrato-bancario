
import { GoogleGenAI, Type } from "@google/genai";
import { fileToBase64 } from "../utils/fileUtils";
import { GeminiTransactionResponse } from "../types";
import { TRANSACTION_CATEGORIES } from '../constants';

const processEnvKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
const windowEnvKey = typeof window !== 'undefined' ? (window as any).ENV?.GEMINI_API_KEY : undefined;

const API_KEY = windowEnvKey !== "__GEMINI_API_KEY__" ? windowEnvKey : processEnvKey;

if (!API_KEY || API_KEY === "__GEMINI_API_KEY__") {
    throw new Error("A variável de ambiente GEMINI_API_KEY não está definida.");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

/**
 * Deep JSON repair for truncated LLM responses.
 * Strategy: find the last complete transaction object in the array,
 * discard anything after it, and properly close the JSON structure.
 */
const repairTruncatedJson = (text: string): string => {
    let cleaned = text.trim();

    // Remove markdown code blocks
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }

    // First, try parsing as-is
    try {
        JSON.parse(cleaned);
        return cleaned;
    } catch {
        // Needs repair
    }

    // Strategy: Find the last complete "}" that closes a transaction object
    // inside the "transactions" array.
    // We look for the pattern: },  followed by { (next transaction) or ] (end of array)
    // If truncated, the last complete transaction ends with }

    // Find the "transactions" array start
    const txArrayMatch = cleaned.indexOf('"transactions"');
    if (txArrayMatch === -1) {
        // Can't find transactions key, try wrapping
        return `{"transactions":[]}`;
    }

    // Find the opening bracket of the transactions array
    const arrayStart = cleaned.indexOf('[', txArrayMatch);
    if (arrayStart === -1) {
        return `{"transactions":[]}`;
    }

    // Now find the last complete transaction object.
    // A complete transaction ends with } and is followed by , or ]
    // We scan backwards from the end to find the last valid closing }
    let depth = 0;
    let lastCompleteObjectEnd = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = arrayStart + 1; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === '\\') {
            escapeNext = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                // We just closed a complete top-level object in the array
                lastCompleteObjectEnd = i;
            }
        }
    }

    if (lastCompleteObjectEnd === -1) {
        // No complete transaction objects found
        return `{"transactions":[]}`;
    }

    // Rebuild: take everything up to and including the last complete object,
    // then close the array and the root object
    let repaired = cleaned.substring(0, lastCompleteObjectEnd + 1);

    // Close the transactions array
    repaired += ']';

    // Check if there were other top-level fields before "transactions"
    // For simplicity, just close the root object
    repaired += '}';

    // Validate the repair
    try {
        JSON.parse(repaired);
        return repaired;
    } catch {
        // If still invalid, try a more aggressive approach:
        // extract just the array content
        try {
            const arrayContent = cleaned.substring(arrayStart, lastCompleteObjectEnd + 1) + ']';
            const fallback = `{"transactions":${arrayContent}}`;
            JSON.parse(fallback);
            return fallback;
        } catch {
            return `{"transactions":[]}`;
        }
    }
};

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        transactions: {
            type: Type.ARRAY,
            description: "Lista de transações financeiras do documento.",
            items: {
                type: Type.OBJECT,
                properties: {
                    date: {
                        type: Type.STRING,
                        description: 'Data: AAAA-MM-DD. Inferir ano se ausente.'
                    },
                    description: {
                        type: Type.STRING,
                        description: 'Descrição completa da transação.'
                    },
                    debit: {
                        type: Type.NUMBER,
                        description: 'Débito (saída). Positivo. 0 se crédito.'
                    },
                    credit: {
                        type: Type.NUMBER,
                        description: 'Crédito (entrada). Positivo. 0 se débito.'
                    },
                    companyName: {
                        type: Type.STRING,
                        description: 'Nome da empresa. Vazio se não houver.'
                    },
                    cnpj: {
                        type: Type.STRING,
                        description: 'CNPJ (só números). Vazio se não houver.'
                    },
                    category: {
                        type: Type.STRING,
                        description: `Categoria: ${TRANSACTION_CATEGORIES.join(', ')}.`
                    },
                    isUnusual: {
                        type: Type.BOOLEAN,
                        description: "true se transação anômala."
                    },
                    unusualReason: {
                        type: Type.STRING,
                        description: "Motivo se incomum (max 50 chars). Vazio se normal."
                    },
                    accountDebit: {
                        type: Type.STRING,
                        description: "Conta débito (ex: 'Bancos'). Vazio se incerto."
                    },
                    accountCredit: {
                        type: Type.STRING,
                        description: "Conta crédito (ex: 'Fornecedores'). Vazio se incerto."
                    },
                    accountingHistory: {
                        type: Type.STRING,
                        description: "Histórico contábil curto (ex: 'PAGTO FORNEC X')."
                    }
                },
                required: ['date', 'description', 'debit', 'credit', 'companyName', 'cnpj', 'category', 'isUnusual', 'unusualReason', 'accountDebit', 'accountCredit', 'accountingHistory']
            }
        },
        finalBalance: {
            type: Type.NUMBER,
            description: "Saldo final do extrato. Omitir se não encontrado."
        },
        bankName: {
            type: Type.STRING,
            description: "Nome do banco. Omitir se não encontrado."
        },
        accountHolderCNPJ: {
            type: Type.STRING,
            description: "CNPJ do titular (só números). Omitir se não encontrado."
        }
    },
    required: ['transactions']
};

const PROMPT_TEXT = `Analise o extrato bancário em PDF. Extraia TODAS as transações com: data (AAAA-MM-DD), descrição, débito ou crédito, empresa, CNPJ. Extraia banco e CNPJ do titular.

VALORES: Débito=saída (negativo/coluna saída), Crédito=entrada (positivo/coluna entrada). Sempre números positivos absolutos.
CONTABILIDADE: Infira accountDebit, accountCredit e accountingHistory em CAIXA ALTA. Use nomes genéricos (Bancos, Fornecedores).
ANOMALIAS: isUnusual=true se valor extremo, descrição vaga, duplicada ou suspeita.
CONCISÃO: Campos inexistentes = "". Descrições curtas. Motivos de anomalia máx 50 chars.`;


export const processBankStatementPDF = async (file: File, maxRetries = 2): Promise<GeminiTransactionResponse> => {
    const base64pdf = await fileToBase64(file);

    const pdfPart = {
        inlineData: {
            mimeType: 'application/pdf',
            data: base64pdf,
        },
    };

    const textPart = { text: PROMPT_TEXT };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`Retry attempt ${attempt}/${maxRetries}...`);
                // Small delay before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: { parts: [textPart, pdfPart] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: responseSchema,
                    temperature: 0.1,
                    maxOutputTokens: 65536,
                },
            });

            const rawText = response.text;
            if (!rawText || rawText.trim().length === 0) {
                throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
            }

            // Use the deep repair function
            const jsonText = repairTruncatedJson(rawText);
            let parsedResponse: GeminiTransactionResponse;

            try {
                parsedResponse = JSON.parse(jsonText);
            } catch (parseError) {
                console.error("Failed to parse even after repair. Raw text length:", rawText.length);
                console.error("Raw text (first 500 chars):", rawText.substring(0, 500));
                console.error("Raw text (last 500 chars):", rawText.substring(rawText.length - 500));
                throw new Error(`JSON Parse error após reparo. Tamanho da resposta: ${rawText.length} chars.`);
            }

            if (!parsedResponse.transactions || !Array.isArray(parsedResponse.transactions)) {
                throw new Error("Estrutura JSON inválida recebida da API.");
            }

            // Ensure all fields are present
            parsedResponse.transactions = parsedResponse.transactions.map(t => ({
                ...t,
                companyName: t.companyName || '',
                cnpj: t.cnpj || '',
                category: t.category || 'Não categorizado',
                isUnusual: t.isUnusual || false,
                unusualReason: t.unusualReason || '',
                accountDebit: t.accountDebit || '',
                accountCredit: t.accountCredit || '',
                accountingHistory: t.accountingHistory || '',
            }));

            // Log if repair was needed (transactions might be partial)
            if (rawText !== jsonText) {
                console.warn(`JSON was repaired. Found ${parsedResponse.transactions.length} complete transactions.`);
            }

            return parsedResponse;

        } catch (error: unknown) {
            console.error(`Attempt ${attempt + 1} failed:`, error);
            if (error instanceof Error) {
                lastError = error;
            } else {
                lastError = new Error("Erro desconhecido ao processar o documento.");
            }
        }
    }

    // All retries failed
    console.error("All attempts failed. Last error:", lastError);
    if (lastError) {
        throw new Error(`O modelo de IA não conseguiu processar este documento após ${maxRetries + 1} tentativas. Detalhe: ${lastError.message}. Verifique se é um extrato bancário válido.`);
    }
    throw new Error("O modelo de IA não conseguiu processar este documento. O arquivo pode estar corrompido ou em um formato não suportado.");
};


export const suggestDateCorrection = async (invalidDate: string): Promise<string> => {
    if (!invalidDate.trim()) return "";
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `Data incorreta: "${invalidDate}". Corrija para AAAA-MM-DD. Responda só a data.`,
            config: {
                temperature: 0,
                stopSequences: ['\n'],
            },
        });

        return response.text.trim();
    } catch (error) {
        console.error("Erro ao sugerir correção de data:", error);
        return invalidDate;
    }
};

export const suggestNewCategory = async (description: string, currentCategory: string): Promise<string> => {
    if (!description.trim()) return currentCategory;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: `Transação: "${description}". Categoria atual: "${currentCategory}". Sugira a melhor de: [${TRANSACTION_CATEGORIES.join(', ')}]. Responda só o nome.`,
            config: {
                temperature: 0.1,
                stopSequences: ['\n'],
            },
        });

        const suggestedCategory = response.text.trim();
        if (TRANSACTION_CATEGORIES.includes(suggestedCategory)) {
            return suggestedCategory;
        }
        return currentCategory;

    } catch (error) {
        console.error("Erro ao sugerir nova categoria:", error);
        return currentCategory;
    }
};
