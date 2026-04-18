import { useState } from 'react'
import Editor from '@monaco-editor/react'
import { Send, ChevronDown, Loader2, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'

const LANGUAGES = [
  { id: 'python', label: 'Python', monacoId: 'python' },
  { id: 'javascript', label: 'JavaScript', monacoId: 'javascript' },
  { id: 'java', label: 'Java', monacoId: 'java' },
  { id: 'cpp', label: 'C++', monacoId: 'cpp' },
  { id: 'go', label: 'Go', monacoId: 'go' },
]

const STARTERS = {
  python: '# Write your solution here\n\ndef solution():\n    pass\n',
  javascript: '// Write your solution here\n\nfunction solution() {\n\n}\n',
  java: '// Write your solution here\n\npublic class Solution {\n    public static void main(String[] args) {\n\n    }\n}\n',
  cpp: '// Write your solution here\n\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n\n    return 0;\n}\n',
  go: '// Write your solution here\n\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("hello")\n}\n',
}

export default function DSACodeEditor({ question, onSubmit, onLanguageChange, disabled = false }) {
  const [lang, setLang] = useState(LANGUAGES[0])
  const [code, setCode] = useState(STARTERS.python)
  const [lineCount, setLineCount] = useState(STARTERS.python.split('\n').length)
  const [charCount, setCharCount] = useState(STARTERS.python.length)

  const changeLang = (newLang) => {
    const existing = code.trim()
    const isDefault = Object.values(STARTERS).some(item => item.trim() === existing) || existing === ''
    if (!isDefault && !window.confirm('Changing language will clear your current code. Continue?')) return

    setLang(newLang)
    const starter = STARTERS[newLang.id]
    setCode(starter)
    setLineCount(starter.split('\n').length)
    setCharCount(starter.length)
    onLanguageChange?.(newLang.id)
  }

  const handleEditorChange = (value = '') => {
    setCode(value)
    setLineCount(value.split('\n').length)
    setCharCount(value.length)
  }

  const handleSubmit = () => {
    if (!code.trim() || code.trim() === STARTERS[lang.id].trim()) {
      toast.error('Please write your solution before submitting.')
      return
    }
    onSubmit?.(code, lang.id)
  }

  return (
    <div className="flex flex-col h-full gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="relative">
          <select
            id="lang-selector"
            value={lang.id}
            onChange={e => changeLang(LANGUAGES.find(item => item.id === e.target.value))}
            className="appearance-none text-sm pl-3 pr-8 py-2 rounded-xl cursor-pointer font-medium"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            {LANGUAGES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs px-3 py-2 rounded-xl"
          style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.18)', color: '#67e8f9' }}>
          <ShieldCheck size={13} />
          OA submission mode
        </div>

        <button
          id="submit-code-btn"
          onClick={handleSubmit}
          disabled={disabled}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl font-semibold text-white transition-all"
          style={{
            background: 'linear-gradient(135deg,#7c3aed,#6d28d9)',
            boxShadow: disabled ? 'none' : '0 4px 14px rgba(124,58,237,0.4)',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          {disabled ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {disabled ? 'Evaluating...' : 'Submit Solution'}
        </button>
      </div>

      <div className="rounded-xl p-3 text-sm"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }}>
        <p className="font-medium mb-1">{question?.title || question?.question_text || 'Coding problem'}</p>
        <p className="text-muted text-xs">
          This round now behaves like an OA submission. Write your final code and submit it for AI evaluation.
        </p>
      </div>

      <div className="flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', minHeight: 280 }}>
        <Editor
          language={lang.monacoId}
          value={code}
          onChange={handleEditorChange}
          theme="vs-dark"
          options={{
            fontSize: 14,
            fontFamily: "'JetBrains Mono', Consolas, monospace",
            minimap: { enabled: false },
            lineNumbers: 'on',
            wordWrap: 'off',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 14, bottom: 14 },
            renderLineHighlight: 'gutter',
            cursorBlinking: 'smooth',
            smoothScrolling: true,
          }}
        />
      </div>

      <div className="flex items-center gap-4 px-1 flex-shrink-0">
        <span className="text-xs text-muted">{lang.label}</span>
        <span className="text-xs text-muted">{lineCount} lines</span>
        <span className="text-xs text-muted">{charCount} chars</span>
      </div>
    </div>
  )
}

