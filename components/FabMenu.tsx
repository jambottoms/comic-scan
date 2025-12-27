'use client';

import { useState } from 'react';
import { Plus, Upload, Video, Search } from 'lucide-react';

interface FabMenuProps {
  onRecord: () => void;
  onUpload: () => void;
  onIdentify: () => void;
}

export default function FabMenu({ onRecord, onUpload, onIdentify }: FabMenuProps) {
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
        
        {/* Record Option */}
        <button 
          onClick={() => { onRecord(); setIsOpen(false); }} 
          className="group flex items-center gap-3"
        >
          <span className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg">
            Record
          </span>
          <div className="bg-red-600 hover:bg-red-500 text-white p-3 rounded-full shadow-lg transition-colors">
            <Video size={24} />
          </div>
        </button>

        {/* Upload Option */}
        <button 
          onClick={() => { onUpload(); setIsOpen(false); }} 
          className="group flex items-center gap-3"
        >
          <span className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg">
            Upload
          </span>
          <div className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-full shadow-lg transition-colors">
            <Upload size={24} />
          </div>
        </button>

        {/* Identify Option */}
        <button 
          onClick={() => { onIdentify(); setIsOpen(false); }} 
          className="group flex items-center gap-3"
        >
          <span className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg">
            Identify
          </span>
          <div className="bg-purple-600 hover:bg-purple-500 text-white p-3 rounded-full shadow-lg transition-colors">
            <Search size={24} />
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
