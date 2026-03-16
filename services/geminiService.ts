import { GoogleGenAI, Type } from "@google/genai";
import { fileToBase64 } from "../utils/fileUtils";
import { GeminiTransactionResponse, GeminiInvestmentResponse } from "../types";
import { TRANSACTION_CATEGORIES } from '../constants';

// Fallback para ambientes sem tipos de Node injetados
declare const process: any;

const getApiKey = () => {
    const windowEnvKey = typeof window !== 'undefined' ? (window as any).ENV?.GEMINI_API_KEY : undefined;
    if (windowEnvKey && windowEnvKey !== "__GEMINI_API_KEY__") return windowEnvKey;

    try {
        if (typeof process !== 'undefined' && process.env) {
            return process.env.GEMINI_API_KEY;
        }
    } catch (e) {
        // Ignora erros de acesso ao process
    }
    return undefined;
};

const API_KEY = getApiKey();

if (!API_KEY || API_KEY === "__GEMINI_API_KEY__") {
    throw new Error("A variável de ambiente GEMINI_API_KEY não está definida.");
}

// FIX: força chamada direta à API do Google, bypassa o proxy automático do SDK em browser
const ai = new GoogleGenAI({
    apiKey: API_KEY,
    httpOptions: {
        baseUrl: 'https://generativelanguage.googleapis.com',
    },
});

// Modelo atualizado para 2.5-flash (mais rápido e preciso)
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Deep JSON repair for truncated LLM responses.
 */
const repairTruncatedJson = (text: string): string => {
    let cleaned = text.trim();

    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }

    try {
        JSON.parse(cleaned);
        return cleaned;
    } catch {
        // Needs repair
    }

    const txArrayMatch = cleaned.indexOf('"transactions"');
    if (txArrayMatch === -1) {
        return `{"transactions":[]}`;
    }

    const arrayStart = cleaned.indexOf('[', txArrayMatch);
    if (arrayStart === -1) {
        return `{"transactions":[]}`;
    }

    let depth = 0;
    let lastCompleteObjectEnd = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = arrayStart + 1; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (escapeNext) { escapeNext = false; continue; }
        if (char === '\\') { escapeNext = true; continue; }
        if (char === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                lastCompleteObjectEnd = i;
            }
        }
    }

    if (lastCompleteObjectEnd === -1) {
        return `{"transactions":[]}`;
    }

    let repaired = cleaned.substring(0, lastCompleteObjectEnd + 1);
    repaired += ']}';

    try {
        JSON.parse(repaired);
        return repaired;
    } catch {
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
                    date: { type: Type.STRING, description: 'Data: AAAA-MM-DD. Inferir ano se ausente.' },
                    description: { type: Type.STRING, description: 'Descrição completa da transação.' },
                    debit: { type: Type.NUMBER, description: 'Débito (saída). Positivo. 0 se crédito.' },
                    credit: { type: Type.NUMBER, description: 'Crédito (entrada). Positivo. 0 se débito.' },
                    companyName: { type: Type.STRING, description: 'Nome da empresa. Vazio se não houver.' },
                    cnpj: { type: Type.STRING, description: 'CNPJ (só números). Vazio se não houver.' },
                    category: { type: Type.STRING, description: `Categoria: ${TRANSACTION_CATEGORIES.join(', ')}.` },
                    isUnusual: { type: Type.BOOLEAN, description: "true se transação anômala." },
                    unusualReason: { type: Type.STRING, description: "Motivo se incomum (max 50 chars). Vazio se normal." },
                    accountDebit: { type: Type.STRING, description: "Conta débito (ex: 'Bancos'). Vazio se incerto." },
                    accountCredit: { type: Type.STRING, description: "Conta crédito (ex: 'Fornecedores'). Vazio se incerto." },
                    accountingHistory: { type: Type.STRING, description: "Histórico contábil curto (ex: 'PAGTO FORNEC X')." }
                },
                required: ['date', 'description', 'debit', 'credit', 'companyName', 'cnpj', 'category', 'isUnusual', 'unusualReason', 'accountDebit', 'accountCredit', 'accountingHistory']
            }
        },
        finalBalance: { type: Type.NUMBER, description: "Saldo final do extrato. Omitir se não encontrado." },
        bankName: { type: Type.STRING, description: "Nome do banco. Omitir se não encontrado." },
        accountHolderCNPJ: { type: Type.STRING, description: "CNPJ do titular (só números). Omitir se não encontrado." }
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
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
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

            const jsonText = repairTruncatedJson(rawText);
            let parsedResponse: GeminiTransactionResponse;

            try {
                parsedResponse = JSON.parse(jsonText);
            } catch (parseError) {
                console.error("Failed to parse even after repair. Raw text length:", rawText.length);
                throw new Error(`JSON Parse error após reparo. Tamanho da resposta: ${rawText.length} chars.`);
            }

            if (!parsedResponse.transactions || !Array.isArray(parsedResponse.transactions)) {
                throw new Error("Estrutura JSON inválida recebida da API.");
            }

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

            if (rawText !== jsonText) {
                console.warn(`JSON was repaired. Found ${parsedResponse.transactions.length} complete transactions.`);
            }

            return parsedResponse;

        } catch (error: unknown) {
            console.error(`Attempt ${attempt + 1} failed:`, error);
            lastError = error instanceof Error ? error : new Error("Erro desconhecido ao processar o documento.");
        }
    }

    if (lastError) {
        throw new Error(`O modelo de IA não conseguiu processar este documento após ${maxRetries + 1} tentativas. Detalhe: ${lastError.message}. Verifique se é um extrato bancário válido.`);
    }
    throw new Error("O modelo de IA não conseguiu processar este documento. O arquivo pode estar corrompido ou em um formato não suportado.");
};


export const suggestDateCorrection = async (invalidDate: string): Promise<string> => {
    if (!invalidDate.trim()) return "";
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: `Data incorreta: "${invalidDate}". Corrija para AAAA-MM-DD. Responda só a data.`,
            config: { temperature: 0, stopSequences: ['\n'] },
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
            model: GEMINI_MODEL,
            contents: `Transação: "${description}". Categoria atual: "${currentCategory}". Sugira a melhor de: [${TRANSACTION_CATEGORIES.join(', ')}]. Responda só o nome.`,
            config: { temperature: 0.1, stopSequences: ['\n'] },
        });
        const suggestedCategory = response.text.trim();
        if (TRANSACTION_CATEGORIES.includes(suggestedCategory)) return suggestedCategory;
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
                    date: { type: Type.STRING, description: 'Data da operação: AAAA-MM-DD.' },
                    fundName: { type: Type.STRING, description: 'Nome completo do fundo de investimento.' },
                    fundCNPJ: { type: Type.STRING, description: 'CNPJ do fundo (somente dígitos, sem pontuação). Vazio se não encontrado.' },
                    operationType: { type: Type.STRING, description: 'Tipo de operação. Valores permitidos: Aplicação, Resgate, Rendimento, Come-cotas, Amortização, Transferência, Outro.' },
                    shareQuantity: { type: Type.NUMBER, description: 'Quantidade de cotas movimentadas. Use valor absoluto positivo. 0 se não informado.' },
                    shareValue: { type: Type.NUMBER, description: 'Valor unitário da cota na data da operação. 0 se não informado.' },
                    grossValue: { type: Type.NUMBER, description: 'Valor bruto da operação em reais. Sempre positivo (absoluto). 0 se não informado.' },
                    irWithheld: { type: Type.NUMBER, description: 'Imposto de Renda retido na fonte em reais. 0 se não houve retenção.' },
                    netValue: { type: Type.NUMBER, description: 'Valor líquido recebido/pago em reais (grossValue - irWithheld). 0 se não informado.' },
                    administrator: { type: Type.STRING, description: 'Nome do administrador do fundo. Vazio se não informado.' },
                    gestor: { type: Type.STRING, description: 'Nome do gestor do fundo. Vazio se não informado.' },
                    isUnusual: { type: Type.BOOLEAN, description: 'true se a operação for anômala.' },
                    unusualReason: { type: Type.STRING, description: 'Motivo da anomalia em até 50 caracteres. Vazio se normal.' },
                },
                required: ['date', 'fundName', 'fundCNPJ', 'operationType', 'shareQuantity', 'shareValue', 'grossValue', 'irWithheld', 'netValue', 'administrator', 'gestor', 'isUnusual', 'unusualReason']
            }
        },
        cotistaNome: { type: Type.STRING, description: 'Nome do cotista. Omitir se não encontrado.' },
        cotistaCNPJ: { type: Type.STRING, description: 'CNPJ ou CPF do cotista (somente dígitos). Omitir se não encontrado.' },
        bankName: { type: Type.STRING, description: 'Nome da corretora/banco. Omitir se não encontrado.' },
        periodStart: { type: Type.STRING, description: 'Data de início do período: AAAA-MM-DD. Omitir se não encontrado.' },
        periodEnd: { type: Type.STRING, description: 'Data de fim do período: AAAA-MM-DD. Omitir se não encontrado.' },
        totalPagesInDocument: { type: Type.NUMBER, description: 'Número total de páginas identificadas no documento.' },
        pagesProcessed: { type: Type.NUMBER, description: 'Número de páginas efetivamente processadas.' },
        isExtractionComplete: { type: Type.BOOLEAN, description: 'true se todas as movimentações foram extraídas.' },
        extractionNotes: { type: Type.STRING, description: 'Notas sobre a extração.' },
    },
    required: ['investmentTransactions']
};

const INVESTMENT_PROMPT_TEXT = `Você está analisando um PDF de "Extrato de Cotista" de fundos de investimento da XP Investimentos (ou similar).

OBJETIVO: Extrair TODAS as movimentações em fundos de investimento listadas no documento, sem exceção.

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

2. DADOS DO EXTRATO: Nome/CNPJ do cotista, nome da corretora, período coberto.

3. ANOMALIAS: marque isUnusual=true se valor discrepante, come-cotas zerado ou data fora do período.

4. **REGRA CRÍTICA**: Extraia TODAS as páginas. NÃO resuma, NÃO pule linhas.

5. **Verificação de Páginas**: Reporte totalPagesInDocument, pagesProcessed e isExtractionComplete.

ATENÇÃO: Se o limite de tokens for atingido, termine o último objeto e feche o JSON corretamente.`;

export const processInvestmentStatementPDF = async (file: File, maxRetries = 2): Promise<GeminiInvestmentResponse> => {
    const base64pdf = await fileToBase64(file);

    const pdfPart = { inlineData: { mimeType: 'application/pdf', data: base64pdf } };
    const textPart = { text: INVESTMENT_PROMPT_TEXT };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            if (attempt > 0) {
                console.log(`[Investment] Retry attempt ${attempt}/${maxRetries}...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }

            const response = await ai.models.generateContent({
                model: GEMINI_MODEL,
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
                throw new Error(`Erro ao processar resposta da IA. Tamanho: ${rawText.length} chars.`);
            }

            if (!parsedResponse.investmentTransactions || !Array.isArray(parsedResponse.investmentTransactions)) {
                throw new Error("Estrutura JSON inválida recebida da API para extrato de investimento.");
            }

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
            lastError = error instanceof Error ? error : new Error("Erro desconhecido ao processar o extrato de investimento.");
        }
    }

    if (lastError) {
        throw new Error(`O modelo de IA não conseguiu processar o Extrato de Cotista após ${maxRetries + 1} tentativas. Detalhe: ${lastError.message}`);
    }
    throw new Error("Falha ao processar o Extrato de Cotista. Verifique se o arquivo é válido.");
};

const repairTruncatedJsonInvestment = (text: string): string => {
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/```$/, '').trim();
    }
    try { JSON.parse(cleaned); return cleaned; } catch { /* needs repair */ }

    const txArrayMatch = cleaned.indexOf('"investmentTransactions"');
    if (txArrayMatch === -1) return '{"investmentTransactions":[], "isExtractionComplete": false, "extractionNotes": "Erro: Campo investmentTransactions não encontrado."}';

    const arrayStart = cleaned.indexOf('[', txArrayMatch);
    if (arrayStart === -1) return '{"investmentTransactions":[], "isExtractionComplete": false, "extractionNotes": "Erro: Início de array não encontrado."}';

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

    if (lastCompleteObjectEnd !== -1) {
        return cleaned.substring(0, lastCompleteObjectEnd + 1) + '], "isExtractionComplete": false, "extractionNotes": "Resposta truncada pela IA. Dados parciais recuperados."}';
    }

    return '{"investmentTransactions":[], "isExtractionComplete": false, "extractionNotes": "Erro crítico no formato da resposta truncada."}';
};
