/**
 * CodeEditor — Monaco-powered code editor with language selector,
 * run (Judge0) and submit buttons, and a status/output bar.
 *
 * Props:
 *   question        {object}  - current question object
 *   onSubmit        {fn}      - called with (code, language)
 *   onLanguageChange{fn}      - called with (language) when language changes
 *   disabled        {bool}    - disables submit while evaluating
 */
import { useState, useRef, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { runCode as apiRunCode } from '../lib/api'
import { Play, Send, ChevronDown, Loader2, Terminal, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

const LANGUAGES = [
  { id: 'python',     label: 'Python',     monacoId: 'python',     judge0: 71 },
  { id: 'javascript', label: 'JavaScript', monacoId: 'javascript', judge0: 63 },
  { id: 'java',       label: 'Java',       monacoId: 'java',       judge0: 62 },
  { id: 'cpp',        label: 'C++',        monacoId: 'cpp',        judge0: 54 },
  { id: 'go',         label: 'Go',         monacoId: 'go',         judge0: 60 },
]

const STARTERS = {
  python:     '# Write your solution here\n\ndef solution():\n    pass\n',
  javascript: '// Write your solution here\n\nfunction solution() {\n\n}\n',
  java:       '// Write your solution here\n\npublic class Solution {\n    public static void main(String[] args) {\n\n    }\n}\n',
  cpp:        '// Write your solution here\n\n#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n\n    return 0;\n}\n',
  go:         '// Write your solution here\n\npackage main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}\n',
}

export default function CodeEditor({ question, onSubmit, onLanguageChange, disabled = false }) {
  const editorRef             = useRef(null)
  const [lang,     setLang]   = useState(LANGUAGES[0])
  const [code,     setCode]   = useState(STARTERS.python)
  const [running,  setRunning]= useState(false)
  const [output,   setOutput] = useState(null)   // { stdout, stderr, status, time, memory }
  const [lineCount,setLC]     = useState(10)
  const [charCount,setCC]     = useState(STARTERS.python.length)

  const handleEditorDidMount = (editor) => { editorRef.current = editor }

  const handleEditorChange = (val = '') => {
    setCode(val)
    setCC(val.length)
    setLC(val.split('\n').length)
  }

  const changeLang = (newLang) => {
    const existing = code.trim()
    const isDefault = Object.values(STARTERS).some(s => s.trim() === existing) || existing === ''
    if (!isDefault && !window.confirm('Changing language will clear your current code. Continue?')) return
    setLang(newLang)
    const starter = STARTERS[newLang.id]
    setCode(starter)
    onLanguageChange?.(newLang.id)
  }

  // ── Run via Judge0 ─────────────────────────────────────────────────────
  const handleRun = async () => {
    if (!code.trim()) { toast.error('Write some code first!'); return }
    setRunning(true)
    setOutput(null)
    try {
      const res = await apiRunCode({ code, language: lang.id })
      setOutput(res.data ?? res)
    } catch (err) {
      const msg = err.response?.data?.error || 'Code runner unavailable.'
      setOutput({ stderr: msg, status: 'error' })
    } finally {
      setRunning(false)
    }
  }

  const handleSubmit = () => {
    if (!code.trim() || code.trim() === STARTERS[lang.id].trim()) {
      toast.error('Please write your solution before submitting.')
      return
    }
    onSubmit?.(code, lang.id)
  }

  const outputOk = output && !output.stderr && output.status !== 'error'

  return (
    <div className="flex flex-col h-full gap-2">

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Language selector */}
        <div className="relative">
          <select
            id="lang-selector"
            value={lang.id}
            onChange={e => changeLang(LANGUAGES.find(l => l.id === e.target.value))}
            className="appearance-none text-sm pl-3 pr-8 py-2 rounded-xl cursor-pointer font-medium"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >
            {LANGUAGES.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        </div>

        <div className="flex-1" />

        {/* Run button */}
        <button
          id="run-code-btn"
          onClick={handleRun}
          disabled={running || disabled}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl font-medium transition-all"
          style={{ background: 'rgba(6,182,212,0.12)', border: '1px solid rgba(6,182,212,0.3)', color: '#22d3ee' }}
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? 'Running…' : 'Run Code'}
        </button>

        {/* Submit button */}
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
          {disabled ? 'Evaluating…' : 'Submit Solution'}
        </button>
      </div>

      {/* ── Monaco Editor ──────────────────────────────────────────────── */}
      <div className="flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', minHeight: 280 }}>
        <Editor
          language={lang.monacoId}
          value={code}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
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

      {/* ── Output panel (visible after Run) ──────────────────────────── */}
      {output && (
        <div
          className="rounded-xl overflow-hidden flex-shrink-0 animate-scale-in"
          style={{ background: '#0d1117', border: `1px solid ${outputOk ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}` }}
        >
          <div className="flex items-center gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <Terminal size={13} className="text-muted" />
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Output</span>
            {output.time && <span className="ml-auto text-xs text-muted">{output.time}ms</span>}
            {outputOk
              ? <CheckCircle size={13} className="text-green-400" />
              : <XCircle size={13} className="text-red-400" />}
          </div>
          <pre className="px-3 py-2 text-xs font-mono overflow-x-auto max-h-28 leading-relaxed"
            style={{ color: outputOk ? '#4ade80' : '#f87171' }}>
            {output.stdout || output.stderr || 'No output'}
          </pre>
        </div>
      )}

      {/* ── Status bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-1 flex-shrink-0">
        <span className="text-xs text-muted">{lang.label}</span>
        <span className="text-xs text-muted">{lineCount} lines</span>
        <span className="text-xs text-muted">{charCount} chars</span>
      </div>
    </div>
  )
}
