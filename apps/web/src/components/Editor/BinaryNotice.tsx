import React from 'react';
import { FileWarning, HardDrive } from 'lucide-react';

interface BinaryNoticeProps {
  filename: string;
  isBinary: boolean;
  size: number;
  truncated?: boolean;
}

export const BinaryNotice: React.FC<BinaryNoticeProps> = ({ filename, isBinary, size, truncated }) => {
  const formattedSize = (size / 1024).toFixed(1) + ' KB';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        backgroundColor: 'var(--surface-1)',
        color: 'var(--text-muted)',
        gap: '12px',
        padding: '20px',
        textAlign: 'center',
      }}
    >
      {isBinary ? (
        <FileWarning size={40} color="var(--warning)" />
      ) : (
        <HardDrive size={40} color="var(--minfy-blue-primary)" />
      )}

      <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>
        {filename}
      </div>

      <div style={{ maxWidth: '400px', fontSize: '13px', lineHeight: '1.5' }}>
        {isBinary
          ? `The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.`
          : truncated
          ? `This file exceeds the 2 MB limit for in-browser editing (${formattedSize}). Opening huge files directly in the browser is restricted to maintain IDE responsiveness.`
          : `Unable to display this file.`}
      </div>

      <div
        style={{
          marginTop: '6px',
          padding: '4px 10px',
          borderRadius: '4px',
          backgroundColor: 'var(--surface-3)',
          fontSize: '11px',
          color: 'var(--text-secondary)',
        }}
      >
        File Size: {formattedSize}
      </div>
    </div>
  );
};
