'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Download, Folder, FolderInput, FolderPlus, Pencil, RotateCcw, Search, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/crud/ConfirmDialog'
import { PromptDialog } from '@/components/crud/PromptDialog'
import { RowMenu } from '@/components/crud/RowMenu'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/use-toast'
import {
  TRASH_RETENTION_DAYS, daysUntil, filterAndSort, formatFileSize, type SortMode, type StoredFile,
} from '@/lib/gate-keep-view'
import { ApiError, api, type FileRow, type FolderRow, type ListResponse, type TrashRow } from './api'
import { MoveDialog } from './MoveDialog'
import { UploadPanel } from './UploadPanel'

type Tab = 'files' | 'trash'
type Target = { kind: 'file' | 'folder'; id: string; name: string; parentId: string }

const FILE_ICON = (
  <svg className="h-4 w-4 flex-shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
  </svg>
)

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const errorMessage = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')

// A folder of the caller's own archive: breadcrumbs, folders, files, move/rename,
// and a trash where removed files wait 28 days before they are deleted for good.
export function FileBrowser() {
  const [folderId, setFolderId] = useState('root')
  const [data, setData]         = useState<ListResponse | null>(null)
  const [trash, setTrash]       = useState<TrashRow[]>([])
  const [loading, setLoading]   = useState(true)

  const [tab, setTab]     = useState<Tab>('files')
  const [query, setQuery] = useState('')
  const [sort, setSort]   = useState<SortMode>('newest')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [renameTarget, setRenameTarget]   = useState<Target | null>(null)
  const [moveTarget, setMoveTarget]       = useState<Target | null>(null)
  const [deleteFolder, setDeleteFolder]   = useState<Target | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<TrashRow | null>(null)
  const [emptyTrashOpen, setEmptyTrashOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const failed = (title: string, err?: unknown) =>
    toast({ variant: 'destructive', title, description: err ? errorMessage(err) : 'Please try again.' })

  // Only the most recent request may update the screen. Without this, a slow response for a
  // folder you have already left arrives late and overwrites the one you are looking at.
  const latest = useRef(0)

  const load = useCallback(async (id: string) => {
    const mine = ++latest.current
    try {
      const res = await api<ListResponse>('GET', `/api/gate-keep/list?folder=${encodeURIComponent(id)}`)
      if (mine !== latest.current) return
      setData(res)
      setFolderId(id)
    } catch (err) {
      if (mine !== latest.current) return
      // The folder was deleted somewhere else: fall back to the top level.
      if (err instanceof ApiError && err.status === 404 && id !== 'root') return load('root')
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [])

  const loadTrash = useCallback(async () => {
    try { setTrash((await api<{ files: TrashRow[] }>('GET', '/api/gate-keep/trash')).files) } catch { /* keep what we have */ }
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([load(folderId), loadTrash()])
    setSelected(new Set())
  }, [load, loadTrash, folderId])

  useEffect(() => { load(folderId); loadTrash() }, [reloadToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const inTrash = tab === 'trash'
  const folders = data?.folders ?? []
  const files   = data?.files ?? []

  const visibleFolders = useMemo(() => {
    const q = query.trim().toLowerCase()
    return folders.filter(f => !q || f.name.toLowerCase().includes(q)).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  }, [folders, query])

  const visibleFiles = useMemo(() => {
    const byId = new Map(files.map(f => [f.id, f]))
    const items: StoredFile[] = files.map(f => ({ key: f.id, filename: f.name, size: f.size, lastModified: f.createdAt }))
    return filterAndSort(items, query, sort).map(i => byId.get(i.key)!)
  }, [files, query, sort])

  const visibleTrash = useMemo(() => {
    const byId = new Map(trash.map(f => [f.id, f]))
    const items: StoredFile[] = trash.map(f => ({ key: f.id, filename: f.name, size: f.size, lastModified: f.deletedAt }))
    return filterAndSort(items, query, sort).map(i => byId.get(i.key)!)
  }, [trash, query, sort])

  const here = data?.breadcrumb.at(-1)
  // Actions always apply to the folder whose contents are on screen, never to one that is still loading.
  const currentId = data?.folderId ?? 'root'
  const folderLabel = here ? here.name : 'Home (top level)'

  // ── actions ────────────────────────────────────────────────────────────────

  async function run(work: () => Promise<void>, failTitle: string) {
    setBusy(true)
    try { await work() } catch (err) { failed(failTitle, err) } finally { setBusy(false) }
  }

  const handleCreateFolder = (name: string) => run(async () => {
    await api('POST', '/api/gate-keep/folders', { parentId: currentId, name })
    setNewFolderOpen(false)
    await refresh()
  }, 'Could not create the folder')

  const handleRename = (name: string) => run(async () => {
    if (!renameTarget) return
    const url = renameTarget.kind === 'file' ? `/api/gate-keep/files/${renameTarget.id}` : `/api/gate-keep/folders/${renameTarget.id}`
    await api('PATCH', url, { name })
    setRenameTarget(null)
    await refresh()
  }, 'Could not rename it')

  const handleMove = (targetId: string) => run(async () => {
    if (!moveTarget) return
    if (moveTarget.kind === 'file') await api('PATCH', `/api/gate-keep/files/${moveTarget.id}`, { folderId: targetId })
    else await api('PATCH', `/api/gate-keep/folders/${moveTarget.id}`, { parentId: targetId })
    setMoveTarget(null)
    await refresh()
    toast({ title: `${moveTarget.name} moved` })
  }, 'Could not move it')

  const handleDeleteFolder = () => run(async () => {
    if (!deleteFolder) return
    try {
      await api('DELETE', `/api/gate-keep/folders/${deleteFolder.id}`)
    } finally {
      setDeleteFolder(null)   // on a refusal too, so the explanation isn't hidden behind the dialog
    }
    await refresh()
  }, 'Could not delete the folder')

  async function handleDownload(id: string) {
    setDownloadingId(id)
    try {
      const { downloadUrl } = await api<{ downloadUrl: string }>('GET', `/api/gate-keep/files/${id}/download`)
      window.location.href = downloadUrl
    } catch (err) {
      failed('Could not prepare the download', err)
    } finally {
      setDownloadingId(null)
    }
  }

  async function restoreIds(ids: string[]) {
    const results = await Promise.allSettled(ids.map(id => api('POST', `/api/gate-keep/files/${id}/restore`)))
    const bad = results.filter(r => r.status === 'rejected').length
    await refresh()
    if (bad > 0) failed(`${plural(bad, 'file')} could not be restored`)
    else toast({ title: ids.length === 1 ? 'File restored' : `${plural(ids.length, 'file')} restored` })
  }

  async function trashFiles(targets: FileRow[]) {
    setBusy(true)
    const results = await Promise.allSettled(targets.map(t => api('DELETE', `/api/gate-keep/files/${t.id}`)))
    const okIds = targets.filter((_, i) => results[i].status === 'fulfilled').map(t => t.id)
    const bad = targets.length - okIds.length

    await refresh()
    setBusy(false)

    if (bad > 0) failed(`${plural(bad, 'file')} could not be moved to trash`)
    if (okIds.length > 0) {
      toast({
        title: okIds.length === 1 && targets.length === 1 ? `${targets[0].name} moved to trash` : `${plural(okIds.length, 'file')} moved to trash`,
        duration: 8000,
        action: <ToastAction altText="Undo move to trash" onClick={() => restoreIds(okIds)}>Undo</ToastAction>,
      })
    }
  }

  const handleDeletePermanently = () => run(async () => {
    if (!deleteTarget) return
    try {
      await api('DELETE', `/api/gate-keep/files/${deleteTarget.id}/permanent`)
      toast({ title: 'File deleted permanently' })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked') failed('This file is locked', err)
      else throw err
    }
    setDeleteTarget(null)
    await refresh()
  }, 'Could not delete the file')

  const handleEmptyTrash = () => run(async () => {
    const { deleted, locked } = await api<{ deleted: number; locked: string[] }>('DELETE', '/api/gate-keep/trash')
    setEmptyTrashOpen(false)
    await refresh()
    toast(locked.length === 0
      ? { title: 'Trash emptied' }
      : { title: `${plural(deleted, 'file')} deleted`, description: `${plural(locked.length, 'file')} could not be deleted yet because of a retention lock.` })
  }, 'Could not empty the trash')

  // ── selection ──────────────────────────────────────────────────────────────

  const allSelected = visibleFiles.length > 0 && visibleFiles.every(f => selected.has(f.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visibleFiles.map(f => f.id)))
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  function switchTab(next: Tab) {
    setTab(next)
    setSelected(new Set())
    setQuery('')
  }

  function open(id: string) {
    setQuery('')
    setSelected(new Set())
    setLoading(true)
    setFolderId(id)
    load(id)
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-[13px] font-medium rounded-full transition-colors ${tab === t ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'}`

  const emptyHere = folders.length === 0 && files.length === 0
  const emptyMessage = query.trim()
    ? `No ${inTrash ? 'files' : 'files or folders'} match "${query.trim()}".`
    : inTrash
      ? `Trash is empty. Files you delete stay here for ${TRASH_RETENTION_DAYS} days.`
      : folderId === 'root' ? 'No files stored yet.' : 'This folder is empty.'

  const folderMenu = (f: FolderRow) => [
    { label: 'Rename',    icon: <Pencil className="h-3.5 w-3.5"/>,      onSelect: () => setRenameTarget({ kind: 'folder', id: f.id, name: f.name, parentId: f.parentId }) },
    { label: 'Move to…',  icon: <FolderInput className="h-3.5 w-3.5"/>, onSelect: () => setMoveTarget({ kind: 'folder', id: f.id, name: f.name, parentId: f.parentId }) },
    { label: 'Delete folder', danger: true, icon: <Trash2 className="h-3.5 w-3.5"/>, onSelect: () => setDeleteFolder({ kind: 'folder', id: f.id, name: f.name, parentId: f.parentId }) },
  ]

  const fileMenu = (f: FileRow) => [
    { label: 'Download',      icon: <Download className="h-3.5 w-3.5"/>,    onSelect: () => handleDownload(f.id) },
    { label: 'Rename',        icon: <Pencil className="h-3.5 w-3.5"/>,      onSelect: () => setRenameTarget({ kind: 'file', id: f.id, name: f.name, parentId: f.folderId }) },
    { label: 'Move to…',      icon: <FolderInput className="h-3.5 w-3.5"/>, onSelect: () => setMoveTarget({ kind: 'file', id: f.id, name: f.name, parentId: f.folderId }) },
    { label: 'Move to trash', danger: true, icon: <Trash2 className="h-3.5 w-3.5"/>, onSelect: () => trashFiles([f]) },
  ]

  return (
    <div>
      <UploadPanel folderId={currentId} folderLabel={folderLabel} onUploaded={() => refresh()}/>

      <div className="mt-10">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-400">Your stored files</p>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="File views" className="flex gap-1">
            <button role="tab" aria-selected={tab === 'files'} onClick={() => switchTab('files')} className={tabClass('files')}>
              Files{data && ` (${files.length})`}
            </button>
            <button role="tab" aria-selected={tab === 'trash'} onClick={() => switchTab('trash')} className={tabClass('trash')}>
              Trash{` (${trash.length})`}
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"/>
              <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search files" aria-label="Search files"
                className="w-40 rounded-full border border-black/[0.12] py-2 pl-8 pr-3 text-[13px] outline-none focus:border-black/40 focus:ring-2 focus:ring-black/10 sm:w-52"/>
            </div>
            <select value={sort} onChange={e => setSort(e.target.value as SortMode)} aria-label="Sort files"
              className="rounded-full border border-black/[0.12] bg-white py-2 pl-3 pr-8 text-[13px] text-gray-700 outline-none focus:border-black/40 focus:ring-2 focus:ring-black/10">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="largest">Largest</option>
            </select>
          </div>
        </div>

        {!inTrash && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
              {data && data.breadcrumb.length > 0 ? (
                <button onClick={() => open('root')} className="text-gray-500 hover:text-black">Home</button>
              ) : (
                <span className="font-medium text-black">Home</span>
              )}
              {data?.breadcrumb.map((c, i, all) => (
                <span key={c.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-gray-300"/>
                  {i === all.length - 1
                    ? <span className="font-medium text-black">{c.name}</span>
                    : <button onClick={() => open(c.id)} className="text-gray-500 hover:text-black">{c.name}</button>}
                </span>
              ))}
            </nav>
            <button onClick={() => setNewFolderOpen(true)} disabled={loading}
              className="flex items-center gap-1.5 rounded-full border border-black/[0.12] px-4 py-1.5 text-[12px] font-semibold transition-colors hover:border-black/30 disabled:opacity-50">
              <FolderPlus className="h-3.5 w-3.5"/> New folder
            </button>
          </div>
        )}

        {inTrash && trash.length > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-[12px] text-gray-500">Files in trash are deleted permanently after {TRASH_RETENTION_DAYS} days.</p>
            <button onClick={() => setEmptyTrashOpen(true)} className="whitespace-nowrap text-[12px] font-semibold text-red-600 hover:text-red-700">
              Empty trash
            </button>
          </div>
        )}

        {!inTrash && selected.size > 0 && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3">
            <p className="text-[13px] font-medium text-gray-700">{selected.size} selected</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setSelected(new Set())} className="text-[12px] text-gray-500 hover:text-gray-900">Clear</button>
              <button onClick={() => trashFiles(files.filter(f => selected.has(f.id)))} disabled={busy}
                className="rounded-full bg-black px-4 py-1.5 text-[12px] font-medium text-white hover:bg-gray-900 disabled:opacity-50">
                Move to trash
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-[52px] animate-pulse rounded-xl border border-black/[0.06] bg-gray-50"/>)}
          </div>
        ) : inTrash ? (
          visibleTrash.length === 0 ? (
            <p className="py-6 text-[13px] text-gray-400">{emptyMessage}</p>
          ) : (
            <ul className="space-y-2">
              {visibleTrash.map(f => {
                const left = daysUntil(f.purgeAt)
                return (
                  <li key={f.id} className="flex items-center gap-3 rounded-xl border border-black/[0.08] px-4 py-3">
                    {FILE_ICON}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-black">{f.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {formatFileSize(f.size)}{left !== null && ` · Deletes in ${plural(left, 'day')}`}
                      </p>
                    </div>
                    <button onClick={() => restoreIds([f.id])}
                      className="flex items-center gap-1.5 whitespace-nowrap rounded-full border border-black/[0.12] px-3 py-1.5 text-[11px] font-semibold transition-colors hover:border-black/30">
                      <RotateCcw className="h-3 w-3"/> Restore
                    </button>
                    <RowMenu label={`Actions for ${f.name}`} items={[
                      { label: 'Delete permanently', danger: true, icon: <Trash2 className="h-3.5 w-3.5"/>, onSelect: () => setDeleteTarget(f) },
                    ]}/>
                  </li>
                )
              })}
            </ul>
          )
        ) : (visibleFolders.length === 0 && visibleFiles.length === 0) ? (
          <p className="py-6 text-[13px] text-gray-400">{emptyHere || !query.trim() ? emptyMessage : emptyMessage}</p>
        ) : (
          <div>
            {visibleFiles.length > 0 && (
              <label className="mb-2 flex items-center gap-3 px-4 text-[12px] text-gray-400">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all files" className="h-3.5 w-3.5 accent-black"/>
                Select all
              </label>
            )}
            <ul className="space-y-2">
              {visibleFolders.map(f => (
                <li key={f.id} className="flex items-center gap-3 rounded-xl border border-black/[0.08] px-4 py-3">
                  <Folder className="h-4 w-4 flex-shrink-0 text-gray-500"/>
                  <button onClick={() => open(f.id)} aria-label={`Open folder ${f.name}`}
                    className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[13px] font-medium text-black">{f.name}</p>
                    <p className="text-[11px] text-gray-400">Folder · {fmtDate(f.createdAt)}</p>
                  </button>
                  <RowMenu label={`Actions for ${f.name}`} items={folderMenu(f)}/>
                </li>
              ))}
              {visibleFiles.map(f => (
                <li key={f.id} className="flex items-center gap-3 rounded-xl border border-black/[0.08] px-4 py-3">
                  <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggleOne(f.id)}
                    aria-label={`Select ${f.name}`} className="h-3.5 w-3.5 flex-shrink-0 accent-black"/>
                  {FILE_ICON}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-black">{f.name}</p>
                    <p className="text-[11px] text-gray-400">{formatFileSize(f.size)} · {fmtDate(f.createdAt)}</p>
                  </div>
                  <button onClick={() => handleDownload(f.id)} disabled={downloadingId === f.id}
                    className="whitespace-nowrap rounded-full border border-black/[0.12] px-3 py-1.5 text-[11px] font-semibold transition-colors hover:border-black/30 disabled:opacity-50">
                    {downloadingId === f.id ? 'Preparing…' : 'Download'}
                  </button>
                  <RowMenu label={`Actions for ${f.name}`} items={fileMenu(f)}/>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <PromptDialog open={newFolderOpen} onOpenChange={setNewFolderOpen} title="New folder" label="Folder name"
        initialValue="" submitLabel="Create" busy={busy} onSubmit={handleCreateFolder}/>

      <PromptDialog open={renameTarget !== null} onOpenChange={o => { if (!o) setRenameTarget(null) }}
        title={renameTarget?.kind === 'folder' ? 'Rename folder' : 'Rename file'} label="Name"
        initialValue={renameTarget?.name ?? ''} submitLabel="Save" busy={busy} onSubmit={handleRename}/>

      <MoveDialog open={moveTarget !== null} onOpenChange={o => { if (!o) setMoveTarget(null) }}
        title={`Move "${moveTarget?.name ?? ''}"`} tree={data?.tree ?? []}
        excludeFolderId={moveTarget?.kind === 'folder' ? moveTarget.id : undefined}
        currentParentId={moveTarget?.parentId ?? 'root'} busy={busy} onMove={handleMove}/>

      <ConfirmDialog open={deleteFolder !== null} onOpenChange={o => { if (!o) setDeleteFolder(null) }}
        title="Delete folder?" description={`"${deleteFolder?.name ?? ''}" will be deleted. It must be empty first.`}
        confirmLabel="Delete folder" destructive busy={busy} onConfirm={handleDeleteFolder}/>

      <ConfirmDialog open={deleteTarget !== null} onOpenChange={o => { if (!o) setDeleteTarget(null) }}
        title="Delete permanently?" description={`"${deleteTarget?.name ?? ''}" will be deleted for good. This cannot be undone.`}
        confirmLabel="Delete permanently" destructive busy={busy} onConfirm={handleDeletePermanently}/>

      <ConfirmDialog open={emptyTrashOpen} onOpenChange={setEmptyTrashOpen}
        title="Empty trash?" description={`${plural(trash.length, 'file')} will be deleted for good. This cannot be undone.`}
        confirmLabel="Empty trash" destructive busy={busy} onConfirm={handleEmptyTrash}/>
    </div>
  )
}
