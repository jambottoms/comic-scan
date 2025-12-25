'use client';

import { useState } from 'react';
import { Plus, BookOpen, ScanLine } from 'lucide-react';

interface FabMenuProps {
  onGradeBook: () => void;
  onAddBook: () => void;
}

export default function FabMenu({ onGradeBook, onAddBook }: FabMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-4">
      {/* Overlay to close when clicking outside */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-[-1]" 
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Menu Items */}
      <div className={`flex flex-col items-end gap-3 transition-all duration-200 ${isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <button 
          onClick={() => { onGradeBook(); setIsOpen(false); }} 
          className="group flex items-center gap-3"
        >
          <span className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
            Grade Book
          </span>
          <div className="bg-purple-600 hover:bg-purple-500 text-white p-3 rounded-full shadow-lg transition-colors">
            <ScanLine size={24} />
          </div>
        </button>

        <button 
          onClick={() => { onAddBook(); setIsOpen(false); }} 
          className="group flex items-center gap-3"
        >
          <span className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
            Add to Collection
          </span>
          <div className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg transition-colors">
            <BookOpen size={24} />
          </div>
        </button>
      </div>
      
      {/* Main FAB */}
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`bg-white hover:bg-gray-100 text-black p-4 rounded-full shadow-lg transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`}
      >
        <Plus size={28} />
      </button>
    </div>
  );
}

