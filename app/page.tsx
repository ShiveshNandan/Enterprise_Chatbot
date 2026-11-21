"use client";

import React, { useEffect, useRef, useState } from "react";

const API_BASE_URL = "http://127.0.0.1:8000";
// const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;
const DEFAULT_API_KEY = process.env.NEXT_PUBLIC_DEFAULT_GOOGLE_API_KEY || "default";

type ChatMode = "pdf" | "general";

interface HistoryItem {
  question: string;
  answer: string;
  model_name: string;
  timestamp: string;
  pdf_names: string[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isError?: boolean;
  timestamp?: string;
  pdfNames?: string[];
}

const STARTER_PROMPTS = [
  "Summarize the key takeaways from the uploaded PDFs",
  "List the main sections or topics covered",
  "Extract any important dates, numbers, or action items",
  "Explain the most complex concept in simple terms",
];

function formatNow(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export default function Home() {
  const [mode, setMode] = useState<ChatMode>("pdf");
  const [useCustomConfig, setUseCustomConfig] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [indexedPdfs, setIndexedPdfs] = useState<string[]>([]);
  const [hasValidPdfUploaded, setHasValidPdfUploaded] = useState<boolean>(false);
  const [chunkSize, setChunkSize] = useState<number>(500);
  const [chunkOverlap, setChunkOverlap] = useState<number>(50);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [panelOpen, setPanelOpen] = useState(true);

  const [isUploading, setIsUploading] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isAsking]);

  const appendAssistantError = (errorText: string) => {
    const errMsg: ChatMessage = {
      id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: "assistant",
      content: `Error: ${errorText}`,
      isError: true,
      timestamp: formatNow(),
    };
    setMessages((prev) => [...prev, errMsg]);
  };

  useEffect(() => {
    const loadHistory = async () => {
      let res: Response | null = null;
      try {
        if(mode === 'general'){
          res = await fetch(`${API_BASE_URL}/history_gen`);
        }
        else{
          res = await fetch(`${API_BASE_URL}/history`);
        }
        if (!res?.ok) return;
        const data = await res.json();
        const history: HistoryItem[] = data.history || [];
        const converted: ChatMessage[] = [];
        history.forEach((item, idx) => {
          converted.push({
            id: `hist-q-${idx}`,
            role: "user",
            content: item.question,
            timestamp: item.timestamp,
          });
          converted.push({
            id: `hist-a-${idx}`,
            role: "assistant",
            content: item.answer,
            timestamp: item.timestamp,
            pdfNames: item.pdf_names,
          });
        });
        setMessages(converted);
        if (history.length > 0 && history[history.length - 1].pdf_names?.length) {
          setIndexedPdfs(history[history.length - 1].pdf_names);
          setHasValidPdfUploaded(true);
        }
      } catch {
        // Backend may not be running yet on initial load
      }
    };
    loadHistory();
  }, [mode]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStatusMessage(null);
    const files = e.target.files ? Array.from(e.target.files) : [];
    const validPdfFiles = files.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );

    if (files.length > 0 && validPdfFiles.length !== files.length) {
      setSelectedFiles(validPdfFiles);
      setHasValidPdfUploaded(false);
      appendAssistantError("Only valid .pdf files are allowed. Non-PDF files were ignored.");
      return;
    }

    setSelectedFiles(validPdfFiles);
    setHasValidPdfUploaded(false);
  };

  const handleProcessPdfs = async () => {
    setStatusMessage(null);

    if (selectedFiles.length === 0) {
      setHasValidPdfUploaded(false);
      appendAssistantError("Select one or more valid PDF files before clicking Index PDFs.");
      return;
    }

    const allValidPdfs = selectedFiles.every(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
    );
    if (!allValidPdfs) {
      setHasValidPdfUploaded(false);
      appendAssistantError("One or more selected files are not valid PDFs.");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => formData.append("files", file));
      formData.append("chunk_size", String(useCustomConfig ? chunkSize : 500));
      formData.append("chunk_overlap", String(useCustomConfig ? chunkOverlap : 50));

      const res = await fetch(`${API_BASE_URL}/process-pdfs`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to process PDFs.");
      }

      const names: string[] = data.pdf_names || [];
      const chunksCount = Number(data.chunks_indexed || 0);
      if (names.length === 0 || chunksCount <= 0) {
        setHasValidPdfUploaded(false);
        throw new Error("Uploaded PDF contained no readable text chunks.");
      }

      setIndexedPdfs(names);
      setHasValidPdfUploaded(true);
      setStatusMessage(
        `Indexed ${chunksCount} chunks from ${names.join(", ")}.`
      );
    } catch (err) {
      setHasValidPdfUploaded(false);
      appendAssistantError(err instanceof Error ? err.message : "PDF upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const sendQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isAsking) return;

    setStatusMessage(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    if (mode === "pdf" && (!hasValidPdfUploaded || indexedPdfs.length === 0)) {
      setPanelOpen(true);
      appendAssistantError(
        "PDF Assistant mode requires a valid PDF to be uploaded and indexed first. Switch to General mode or upload a valid PDF."
      );
      return;
    }

    const effectiveApiKey = useCustomConfig ? apiKey.trim() : DEFAULT_API_KEY;
    if (!effectiveApiKey) {
      setPanelOpen(true);
      appendAssistantError(
        "Custom Google AI API Key is missing. Please enter your API key in the Custom setup section and try again."
      );
      return;
    }

    setIsAsking(true);

    try {
      const res = await fetch(`${API_BASE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          api_key: effectiveApiKey,
          model_name: "Google AI",
          mode,
          chunk_size: useCustomConfig ? chunkSize : 500,
          chunk_overlap: useCustomConfig ? chunkOverlap : 50,
          k: 4,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to get answer from backend.");
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: data.timestamp,
        pdfNames: data.pdf_names,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      appendAssistantError(
        err instanceof Error ? err.message : "Unexpected error while requesting answer."
      );
    } finally {
      setIsAsking(false);
    }
  };

  const sendGenQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isAsking) return;

    setStatusMessage(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    const effectiveApiKey = useCustomConfig ? apiKey.trim() : DEFAULT_API_KEY;
    if (!effectiveApiKey) {
      setPanelOpen(true);
      appendAssistantError(
        "Custom Google AI API Key is missing. Please enter your API key in the Custom setup section and try again."
      );
      return;
    }

    setIsAsking(true);

    try {
      const res = await fetch(`${API_BASE_URL}/gen_ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          api_key: effectiveApiKey,
          model_name: "Google AI",
          mode,
          k: 4,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Failed to get answer from backend.");
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        timestamp: data.timestamp,
        pdfNames: data.pdf_names,
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      appendAssistantError(
        err instanceof Error ? err.message : "Unexpected error while requesting answer."
      );
    } finally {
      setIsAsking(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log(mode);
    if(mode !== 'general'){
      console.log("hello")
      sendQuestion(input);
    }else {
      console.log("hello2")
      sendGenQuestion(input);
    }
  };

  const handleReset = async () => {
    setStatusMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/reset?delete_index=false`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("Backend returned an error while resetting state.");
      }
      setMessages([]);
      setIndexedPdfs([]);
      setSelectedFiles([]);
      setHasValidPdfUploaded(false);
      setStatusMessage("Conversation history reset.");
    } catch (err) {
      appendAssistantError(
        err instanceof Error ? err.message : "Could not reset backend state."
      );
    }
  };

  const handleDownloadCsv = () => {
    if(mode === 'general'){
      window.open(`${API_BASE_URL}/history_gen/csv`, "_blank");
    }else{
      window.open(`${API_BASE_URL}/history/csv`, "_blank");
    }
  };

  return (
    <div className="min-h-screen bg-[#131314] text-[#e3e3e3] flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 px-5 py-3 bg-[#131314]/90 backdrop-blur border-b border-[#282a2c]">
        <div className="flex items-center gap-3">
          <span className="text-base font-medium tracking-tight text-[#f2f2f2]">
            PDF Assistant
          </span>

          {/* Cool Segmented Mode Switch */}
          <div
            role="group"
            aria-label="Chat mode switch"
            className="relative inline-flex items-center p-0.5 rounded-full bg-[#1e1f20] border border-[#333537] shadow-inner"
          >
            <button
              type="button"
              onClick={() => setMode("pdf")}
              className={`relative z-10 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
                mode === "pdf"
                  ? "bg-gradient-to-r from-[#4285f4] to-[#9b72cb] text-white shadow-sm"
                  : "text-[#9aa0a6] hover:text-[#e3e3e3]"
              }`}
            >
              <span>PDF Assistant</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("general")}
              className={`relative z-10 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 cursor-pointer ${
                mode === "general"
                  ? "bg-gradient-to-r from-[#8ab4f8] to-[#81c995] text-[#062e6f] shadow-sm font-semibold"
                  : "text-[#9aa0a6] hover:text-[#e3e3e3]"
              }`}
            >
              <span>General</span>
            </button>
          </div>

          {mode === "pdf" && hasValidPdfUploaded && indexedPdfs.length > 0 && (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#1e1f20] text-[#a8c7fa] border border-[#333537]">
              {indexedPdfs.length} PDF{indexedPdfs.length > 1 ? "s" : ""} indexed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPanelOpen((prev) => !prev)}
            className="text-xs px-3 py-1.5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-[#333537] transition cursor-pointer"
          >
            {panelOpen ? "Hide PDF & Key Setup" : "PDF & Key Setup"}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            className="text-xs px-3 py-1.5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-[#333537] transition cursor-pointer"
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="text-xs px-3 py-1.5 rounded-full bg-[#1e1f20] hover:bg-[#282a2c] text-[#f2b8b5] border border-[#333537] transition cursor-pointer"
          >
            Reset
          </button>
        </div>
      </header>

      {/* Collapsible Setup Drawer */}
      {panelOpen && (
        <section className="border-b border-[#282a2c] bg-[#18191b]">
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
            {/* Custom Key & Chunk Config Section */}
            <div className="rounded-2xl bg-[#1e1f20] border border-[#333537] p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#e3e3e3]">Custom</span>
                <button
                  type="button"
                  onClick={() => setUseCustomConfig((prev) => !prev)}
                  className={`text-xs px-3 py-1 rounded-full border transition cursor-pointer ${
                    useCustomConfig
                      ? "bg-[#a8c7fa] text-[#062e6f] border-[#a8c7fa] font-medium"
                      : "bg-[#131314] text-[#9aa0a6] border-[#333537]"
                  }`}
                >
                  {useCustomConfig ? "Enabled" : "Off (Using Fixed Key)"}
                </button>
              </div>

              {useCustomConfig && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-[#9aa0a6] mb-1">
                      Google AI API Key
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste your Gemini API key..."
                      className="w-full rounded-xl bg-[#131314] border border-[#333537] px-3.5 py-2 text-sm text-[#e3e3e3] placeholder-[#75787c] focus:outline-none focus:border-[#a8c7fa]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-[#9aa0a6] mb-1">
                        Chunk Size
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={4000}
                        value={chunkSize}
                        onChange={(e) => setChunkSize(Number(e.target.value) || 500)}
                        className="w-full rounded-xl bg-[#131314] border border-[#333537] px-3 py-2 text-sm text-[#e3e3e3] focus:outline-none focus:border-[#a8c7fa]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#9aa0a6] mb-1">
                        Overlap
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={chunkOverlap}
                        onChange={(e) => setChunkOverlap(Number(e.target.value) || 50)}
                        className="w-full rounded-xl bg-[#131314] border border-[#333537] px-3 py-2 text-sm text-[#e3e3e3] focus:outline-none focus:border-[#a8c7fa]"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {mode === "pdf" && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs px-3.5 py-2 rounded-xl bg-[#1e1f20] hover:bg-[#282a2c] text-[#e3e3e3] border border-[#333537] transition cursor-pointer"
                  >
                    Choose PDFs
                  </button>
                  <span className="text-xs text-[#9aa0a6]">
                    {selectedFiles.length > 0
                      ? selectedFiles.map((f) => f.name).join(", ")
                      : "No new files selected"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleProcessPdfs}
                  disabled={isUploading}
                  className="text-xs font-medium px-4 py-2 rounded-xl bg-[#a8c7fa] hover:bg-[#8ab4f8] disabled:opacity-50 text-[#062e6f] transition cursor-pointer"
                >
                  {isUploading ? "Indexing..." : "Index PDFs"}
                </button>
              </div>
            )}

            {statusMessage && (
              <p className="text-xs text-[#81c995]">{statusMessage}</p>
            )}
          </div>
        </section>
      )}

      {/* Main Centered Conversation Stream */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 py-8 flex flex-col">
        {messages.length === 0 ? (
          <div className="my-auto py-8 space-y-6">
            <div className="space-y-1">
              <h1 className="text-3xl md:text-4xl font-medium tracking-tight bg-gradient-to-r from-[#4285f4] via-[#9b72cb] to-[#d96570] bg-clip-text text-transparent">
                Ask anything about your PDFs
              </h1>
              <p className="text-sm text-[#9aa0a6]">
                Upload documents above, add your API key, and start asking questions.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendQuestion(prompt)}
                  className="text-left p-4 rounded-2xl bg-[#1e1f20] hover:bg-[#282a2c] border border-transparent hover:border-[#3c4043] text-sm text-[#e3e3e3] transition cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-3xl rounded-br-md bg-[#282a2c] px-5 py-3 text-sm leading-relaxed text-[#f2f2f2] whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex items-start gap-3.5">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0 mt-0.5 ${
                      msg.isError
                        ? "bg-gradient-to-tr from-[#d96570] to-[#f28b82]"
                        : "bg-gradient-to-tr from-[#4285f4] to-[#9b72cb]"
                    }`}
                  >
                    AI
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div
                      className={`text-sm leading-7 whitespace-pre-wrap ${
                        msg.isError
                          ? "rounded-2xl bg-[#2b1a1c] border border-[#5c2b2e] px-4 py-3 text-[#f2b8b5]"
                          : "text-[#e3e3e3]"
                      }`}
                    >
                      {msg.content}
                      {/* {msg.isError ? "Tokens exhausted, please try after sometime" : msg.content} */}
                    </div>
                    {(msg.timestamp || (msg.pdfNames && msg.pdfNames.length > 0)) && (
                      <div className="text-[11px] text-[#8e918f]">
                        {msg.pdfNames && msg.pdfNames.length > 0
                          ? `Sources: ${msg.pdfNames.join(", ")}`
                          : ""}
                        {msg.timestamp ? ` • ${msg.timestamp}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            {isAsking && (
              <div className="flex items-start gap-3.5">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#4285f4] to-[#9b72cb] flex items-center justify-center text-xs font-semibold text-white shrink-0">
                  AI
                </div>
                <div className="text-sm text-[#9aa0a6] py-1.5 animate-pulse">
                  Searching indexed chunks and generating response...
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </main>

      {/* Bottom Floating Composer */}
      <footer className="sticky bottom-0 bg-gradient-to-t from-[#131314] via-[#131314] to-transparent pt-3 pb-5 px-4">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto flex items-end gap-2 rounded-3xl bg-[#1e1f20] border border-[#333537] focus-within:border-[#8ab4f8] px-4 py-2.5"
        >
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if(mode === "general"){
                  sendGenQuestion(input)
                }else{
                  sendQuestion(input)
                }
              }
            }}
            placeholder={
              mode === "pdf"
                ? "Ask a question from your PDFs..."
                : "Ask anything in General mode..."
            }
            className="flex-1 resize-none bg-transparent text-sm text-[#e3e3e3] placeholder-[#8e918f] focus:outline-none max-h-40 py-1"
          />
          <button
            type="submit"
            disabled={mode === "general" ? (isAsking || !input.trim()) : ( !hasValidPdfUploaded || isAsking || !input.trim())}
            className="px-4 py-1.5 rounded-full bg-[#a8c7fa] hover:bg-[#8ab4f8] disabled:opacity-40 text-xs font-medium text-[#062e6f] transition shrink-0 cursor-pointer"
          >
            {isAsking ? "..." : "Send"}
          </button>
        </form>
      </footer>
    </div>
  );
}