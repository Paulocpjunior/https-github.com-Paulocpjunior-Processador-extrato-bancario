import React, { useState, useCallback } from 'react';
import { DocumentArrowUpIcon } from './icons/Icons';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
}

export const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragging(true);
    } else if (e.type === "dragleave") {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      if (e.dataTransfer.files[0].type === "application/pdf") {
          onFileSelect(e.dataTransfer.files[0]);
      } else {
          alert("Por favor, envie um arquivo PDF.");
      }
    }
  }, [onFileSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
       if (e.target.files[0].type === "application/pdf") {
            onFileSelect(e.target.files[0]);
        } else {
            alert("Por favor, envie um arquivo PDF.");
        }
    }
  };

  return (
    <div 
        className={`mt-10 max-w-3xl mx-auto flex justify-center rounded-xl border-2 border-dashed ${isDragging ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-300 dark:border-slate-600'} p-12 text-center transition-colors duration-300`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
    >
      <div className="space-y-4">
        <DocumentArrowUpIcon className="mx-auto h-16 w-16 text-slate-400 dark:text-slate-500" />
        <div className="flex text-lg text-slate-600 dark:text-slate-300">
          <label
            htmlFor="file-upload"
            className="relative cursor-pointer rounded-md font-semibold text-blue-600 dark:text-blue-400 focus-within:outline-none focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 hover:text-blue-500"
          >
            <span>Envie um arquivo</span>
            <input id="file-upload" name="file-upload" type="file" accept=".pdf" className="sr-only" onChange={handleChange} />
          </label>
          <p className="pl-1">ou arraste e solte</p>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">PDF de até 10MB</p>
      </div>
    </div>
  );
};