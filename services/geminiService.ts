
import { GoogleGenAI, Type } from "@google/genai";
import { fileToBase64 } from "../utils/fileUtils";
import { GeminiTransactionResponse, GeminiInvestmentResponse } from "../types";
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

// ─── Extrato de Cotista XP ────────────────────────────────────────────────────

const investmentResponseSchema = {
    type: Type.OBJECT,
    properties: {
        investmentTransactions: {
            type: Type.ARRAY,
            description: "Lista de movimentações em fundos de investimento do Extrato de Cotista.",
            items: {
                type: Type.OBJECT,
                properties: {
                    date: {
                        type: Type.STRING,
                        description: 'Data da operação: AAAA-MM-DD.'
                    },
                    fundName: {
                        type: Type.STRING,
                        description: 'Nome completo do fundo de investimento.'
                    },
                    fundCNPJ: {
                        type: Type.STRING,
                        description: 'CNPJ do fundo (somente dígitos, sem pontuação). Vazio se não encontrado.'
                    },
                    operationType: {
                        type: Type.STRING,
                        description: 'Tipo de operação. Valores permitidos: Aplicação, Resgate, Rendimento, Come-cotas, Amortização, Transferência, Outro.'
                    },
                    shareQuantity: {
                        type: Type.NUMBER,
                        description: 'Quantidade de cotas movimentadas. Use valor absoluto positivo. 0 se não informado.'
                    },
                    shareValue: {
                        type: Type.NUMBER,
                        description: 'Valor unitário da cota na data da operação. 0 se não informado.'
                    },
                    grossValue: {
                        type: Type.NUMBER,
                        description: 'Valor bruto da operação em reais. Sempre positivo (absoluto). 0 se não informado.'
                    },
                    irWithheld: {
                        type: Type.NUMBER,
                        description: 'Imposto de Renda retido na fonte em reais. 0 se não houve retenção.'
                    },
                    netValue: {
                        type: Type.NUMBER,
                        description: 'Valor líquido recebido/pago em reais (grossValue - irWithheld). 0 se não informado.'
                    },
                    administrator: {
                        type: Type.STRING,
                        description: 'Nome do administrador do fundo. Vazio se não informado.'
                    },
                    gestor: {
                        type: Type.STRING,
                        description: 'Nome do gestor do fundo. Vazio se não informado.'
                    },
                    isUnusual: {
                        type: Type.BOOLEAN,
                        description: 'true se a operação for anômala (valor extremo, data inconsistente, etc.).'
                    },
                    unusualReason: {
                        type: Type.STRING,
                        description: 'Motivo da anomalia em até 50 caracteres. Vazio se normal.'
                    },
                },
                required: ['date', 'fundName', 'fundCNPJ', 'operationType', 'shareQuantity', 'shareValue', 'grossValue', 'irWithheld', 'netValue', 'administrator', 'gestor', 'isUnusual', 'unusualReason']
            }
        },
        cotistaNome: {
            type: Type.STRING,
            description: 'Nome do cotista (pessoa física ou jurídica titular do extrato). Omitir se não encontrado.'
        },
        cotistaCNPJ: {
            type: Type.STRING,
            description: 'CNPJ ou CPF do cotista (somente dígitos). Omitir se não encontrado.'
        },
        bankName: {
            type: Type.STRING,
            description: 'Nome da corretora/banco (ex: XP Investimentos). Omitir se não encontrado.'
        },
        periodStart: {
            type: Type.STRING,
            description: 'Data de início do período do extrato no formato AAAA-MM-DD. Omitir se não encontrado.'
        },
        periodEnd: {
            type: Type.STRING,
            description: 'Data de fim do período do extrato no formato AAAA-MM-DD. Omitir se não encontrado.'
        },
    },
    required: ['investmentTransactions']
};

const INVESTMENT_PROMPT_TEXT = `Você está analisando um PDF de "Extrato de Cotista" de fundos de investimento da XP Investimentos (ou similar).

OBJETIVO: Extrair TODAS as movimentações em fundos de investimento listadas no documento.

INSTRUÇÕES DE EXTRAÇÃO:
1. Para cada movimentação extraia:
   - DATA (formato AAAA-MM-DD)
   - NOME DO FUNDO (nome completo como aparece no extrato)
   - CNPJ DO FUNDO (somente dígitos, 14 números)
   - TIPO DE OPERAÇÃO: classifique como um destes: Aplicação, Resgate, Rendimento, Come-cotas, Amortização, Transferência, Outro
   - QUANTIDADE DE COTAS movimentadas (número decimal)
   - VALOR DA COTA (preço unitário da cota na data)
   - VALOR BRUTO da operação em R$ (sempre positivo)
   - IR RETIDO NA FONTE em R$ (0 se não houver)
   - VALOR LÍQUIDO = valor após desconto de IR

2. DADOS DO EXTRATO:
   - Nome/razão social do cotista
   - CNPJ ou CPF do cotista (somente dígitos)
   - Nome da corretora (ex: XP Investimentos)
   - Período coberto pelo extrato

3. RECONHECIMENTO DE TIPOS DE OPERAÇÃO:
   - "Aplicação" = compra de cotas / entrada de recursos no fundo
   - "Resgate" = venda de cotas / saída de recursos do fundo
   - "Come-cotas" = recolhimento semestral antecipado de IR (maio e novembro)
   - "Rendimento" = crédito de rendimento sem movimentação de cotas
   - "Amortização" = devolução parcial de capital pelo fundo
   - "Transferência" = movimentação entre fundos ou contas

4. ADMININSTRADOR e GESTOR: extraia se aparecerem no cabeçalho ou rodapé do extrato.

5. ANOMALIAS: marque isUnusual=true se:
   - Valor muito discrepante dos demais
   - Come-cotas com valor zerado (suspeito)
   - Data fora do período do extrato

ATENÇÃO: Extraia TODAS as linhas de movimentação. Não pule nenhuma. Valores numéricos sempre positivos.`;

export const processInvestmentStatementPDF = async (file: File, maxRetries = 2): Promise<GeminiInvestmentResponse> => {
    const base64pdf = await fileToBase64(file);

    const pdfPart = {
        inlineData: {
            mimeType: 'application/pdf',
            data: base64pdf,
        },
    };

    const textPart = { text: INVESTMENT_PROMPT_TEXT };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`[Investment] Retry attempt ${attempt}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: { parts: [textPart, pdfPart] },
                config: {
                    responseMimeType: "application/json",
                    responseSchema: investmentResponseSchema,
                    temperature: 0.1,
                    maxOutputTokens: 65536,
                },
            });

            const rawText = response.text;
            if (!rawText || rawText.trim().length === 0) {
                throw new Error("A IA retornou uma resposta vazia. Tente novamente.");
            }

            const jsonText = repairTruncatedJsonInvestment(rawText);
            let parsedResponse: GeminiInvestmentResponse;

            try {
                parsedResponse = JSON.parse(jsonText);
            } catch (parseError) {
                console.error("[Investment] Failed to parse response. Raw text length:", rawText.length);
                throw new Error(`Erro ao processar resposta da IA. Tamanho: ${rawText.length} chars.`);
            }

            if (!parsedResponse.investmentTransactions || !Array.isArray(parsedResponse.investmentTransactions)) {
                throw new Error("Estrutura JSON inválida recebida da API para extrato de investimento.");
            }

            // Normalizar campos ausentes
            parsedResponse.investmentTransactions = parsedResponse.investmentTransactions.map(t => ({
                ...t,
                fundName: t.fundName || 'Fundo não identificado',
                fundCNPJ: t.fundCNPJ || '',
                operationType: t.operationType || 'Outro',
                shareQuantity: t.shareQuantity || 0,
                shareValue: t.shareValue || 0,
                grossValue: Math.abs(t.grossValue || 0),
                irWithheld: Math.abs(t.irWithheld || 0),
                netValue: Math.abs(t.netValue || 0),
                administrator: t.administrator || '',
                gestor: t.gestor || '',
                isUnusual: t.isUnusual || false,
                unusualReason: t.unusualReason || '',
            }));

            return parsedResponse;

        } catch (error: unknown) {
            console.error(`[Investment] Attempt ${attempt + 1} failed:`, error);
            if (error instanceof Error) {
                lastError = error;
            } else {
                lastError = new Error("Erro desconhecido ao processar o extrato de investimento.");
            }
        }
    }

    console.error("[Investment] All attempts failed. Last error:", lastError);
    if (lastError) {
        throw new Error(`O modelo de IA não conseguiu processar o Extrato de Cotista após ${maxRetries + 1} tentativas. Detalhe: ${lastError.message}`);
    }
    throw new Error("Falha ao processar o Extrato de Cotista. Verifique se o arquivo é válido.");
};

/**
 * Versão do repairTruncatedJson adaptada para o schema de investimentos
 * (campo raiz é "investmentTransactions" em vez de "transactions")
 */
const repairTruncatedJsonInvestment = (text: string): string => {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }
    try {
        JSON.parse(cleaned);
        return cleaned;
    } catch { /* needs repair */ }

    const txArrayMatch = cleaned.indexOf('"investmentTransactions"');
    if (txArrayMatch === -1) return '{"investmentTransactions":[]}';

    const arrayStart = cleaned.indexOf('[', txArrayMatch);
    if (arrayStart === -1) return '{"investmentTransactions":[]}';

    let depth = 0, lastCompleteObjectEnd = -1, inString = false, escapeNext = false;
    for (let i = arrayStart + 1; i < cleaned.length; i++) {
        const char = cleaned[i];
        if (escapeNext) { escapeNext = false; continue; }
        if (char === '\\') { escapeNext = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (char === '{') depth++;
        else if (char === '}') { depth--; if (depth === 0) lastCompleteObjectEnd = i; }
    }

    if (lastCompleteObjectEnd === -1) return '{"investmentTransactions":[]}';

    let repaired = cleaned.substring(0, lastCompleteObjectEnd + 1) + ']}';
    try { JSON.parse(repaired); return repaired; } catch { /* try fallback */ }

    try {
        const fallback = `{"investmentTransactions":${cleaned.substring(arrayStart, lastCompleteObjectEnd + 1)}]}`;
        JSON.parse(fallback);
        return fallback;
    } catch { return '{"investmentTransactions":[]}'; }
};
