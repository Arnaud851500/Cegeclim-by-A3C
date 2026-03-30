'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type DocType = 'folder' | 'file'
type ScopeType = 'Global' | 'Societe' | 'Agence'
type SocieteType = 'Cegeclim' | 'CVC' | null

type DocItem = {
  id: string
  name: string
  type: DocType
  parent_id: string | null
  storage_path: string | null
  size: number | null
  mime_type: string | null
  created_at: string | null
  updated_at: string | null
  scope_type: ScopeType | null
  societe: SocieteType
  agence: string | null
  linked_entity_type: string | null
  linked_entity_id: string | null
}

type TreeNode = DocItem & {
  children: TreeNode[]
}

type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'date-desc'
  | 'date-asc'
  | 'size-desc'
  | 'size-asc'

const BUCKET_NAME = 'documents'

export default function DocumentsPage() {
  const [items, setItems] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('date-desc')

  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [renamingItemId, setRenamingItemId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const [movingItemId, setMovingItemId] = useState<string | null>(null)
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>('ROOT')

  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewScale, setPreviewScale] = useState(100)

  const [visionScope, setVisionScope] = useState<'Global' | 'Cegeclim' | 'CVC'>('Global')
  const [filterAgence, setFilterAgence] = useState<string>('all')

  const [dragActive, setDragActive] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    loadDocuments()
  }, [])

  useEffect(() => {
    if (!selectedItemId) {
      setPreviewUrl(null)
      return
    }

    const item = items.find((x) => x.id === selectedItemId)
    if (!item || item.type !== 'file' || !item.storage_path) {
      setPreviewUrl(null)
      return
    }

    loadPreviewUrl(item)
  }, [selectedItemId, items])

  async function loadDocuments() {
    setLoading(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('type', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) {
      console.error(error)
      setMessage(`Erreur chargement documents : ${error.message}`)
      setLoading(false)
      return
    }

    const rows = ((data || []) as DocItem[]).map((row) => ({
      ...row,
      scope_type: row.scope_type ?? 'Global',
      societe: row.societe ?? null,
      agence: row.agence ?? null,
      linked_entity_type: row.linked_entity_type ?? null,
      linked_entity_id: row.linked_entity_id ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
    }))

    setItems(rows)

    if (selectedItemId && !rows.some((x) => x.id === selectedItemId)) {
      setSelectedItemId(null)
    }

    if (currentFolderId && !rows.some((x) => x.id === currentFolderId)) {
      setCurrentFolderId(null)
    }

    setLoading(false)
  }

  async function loadPreviewUrl(item: DocItem) {
    if (!item.storage_path) {
      setPreviewUrl(null)
      return
    }

    setPreviewLoading(true)

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(item.storage_path, 60)

    if (error || !data?.signedUrl) {
      console.error(error)
      setPreviewUrl(null)
      setPreviewLoading(false)
      return
    }

    setPreviewUrl(data.signedUrl)
    setPreviewLoading(false)
  }

  const agencesDisponibles = useMemo(() => {
    const values = items
      .map((x) => x.agence)
      .filter((x): x is string => Boolean(x && x.trim()))
      .sort((a, b) => a.localeCompare(b, 'fr'))

    return Array.from(new Set(values))
  }, [items])

  const visibleItems = useMemo(() => {
    return items.filter((item) => isItemVisibleForVision(item, visionScope, filterAgence))
  }, [items, visionScope, filterAgence])

  const itemsByParent = useMemo(() => {
    const map = new Map<string | null, DocItem[]>()

    for (const item of visibleItems) {
      const key = item.parent_id ?? null
      const arr = map.get(key) || []
      arr.push(item)
      map.set(key, arr)
    }

    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
        return a.name.localeCompare(b.name, 'fr')
      })
    }

    return map
  }, [visibleItems])

  const currentFolders = useMemo(() => {
    return (itemsByParent.get(null) || []).filter((x) => x.type === 'folder')
  }, [itemsByParent])

  const currentFolderChildren = useMemo(() => {
    let children = [...(itemsByParent.get(currentFolderId) || [])]

    if (search.trim()) {
      const q = search.toLowerCase()
      children = children.filter((item) => item.name.toLowerCase().includes(q))
    }

    children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1

      switch (sortBy) {
        case 'name-asc':
          return a.name.localeCompare(b.name, 'fr')
        case 'name-desc':
          return b.name.localeCompare(a.name, 'fr')
        case 'date-desc':
          return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime()
        case 'date-asc':
          return new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime()
        case 'size-desc':
          return (b.size || 0) - (a.size || 0)
        case 'size-asc':
          return (a.size || 0) - (b.size || 0)
        default:
          return a.name.localeCompare(b.name, 'fr')
      }
    })

    return children
  }, [itemsByParent, currentFolderId, search, sortBy])

  const selectedItem = useMemo(() => {
    return visibleItems.find((item) => item.id === selectedItemId) || null
  }, [visibleItems, selectedItemId])

  const currentFolder = useMemo(() => {
    return visibleItems.find((x) => x.id === currentFolderId) || null
  }, [visibleItems, currentFolderId])

  const breadcrumb = useMemo(() => {
    const result: DocItem[] = []
    let cursor = visibleItems.find((i) => i.id === currentFolderId) || null

    while (cursor) {
      result.unshift(cursor)
      cursor = visibleItems.find((i) => i.id === cursor?.parent_id) || null
    }

    return result
  }, [visibleItems, currentFolderId])

  const moveTargetOptions = useMemo(() => {
    return visibleItems
      .filter(
        (x) =>
          x.type === 'folder' &&
          x.id !== movingItemId &&
          !isDescendantFolder(movingItemId, x.id, visibleItems)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [visibleItems, movingItemId])

  function sanitizeName(value: string) {
    return value.trim().replace(/[\/\\]+/g, '-').replace(/\s+/g, ' ')
  }

  function formatSize(size: number | null) {
    if (size == null) return '-'
    if (size < 1024) return `${size} o`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} ko`
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} Mo`
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} Go`
  }

  function formatDate(value: string | null) {
    if (!value) return '-'
    return new Date(value).toLocaleString('fr-FR')
  }

  function formatDateShort(value: string | null) {
    if (!value) return '-'
    return new Date(value).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  function getFileIcon(item: DocItem) {
    if (item.type === 'folder') return '📁'
    const ext = item.name.split('.').pop()?.toLowerCase()

    if (ext === 'pdf') return '📕'
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return '📗'
    if (['doc', 'docx', 'ppt', 'pptx'].includes(ext || '')) return '📘'
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext || '')) return '🖼️'
    if (['zip', 'rar', '7z'].includes(ext || '')) return '🗜️'
    if (['html', 'htm'].includes(ext || '')) return '🌐'
    return '📄'
  }

  function getFileTypeLabel(item: DocItem) {
    if (item.type === 'folder') return 'Dossier'
    const ext = item.name.split('.').pop()?.toLowerCase()
    return ext ? `.${ext}` : 'Fichier'
  }

  function getFolderPath(folderId: string | null) {
    if (!folderId) return ''

    const segments: string[] = []
    let cursor = items.find((i) => i.id === folderId) || null

    while (cursor) {
      segments.unshift(sanitizeName(cursor.name))
      cursor = items.find((i) => i.id === cursor?.parent_id) || null
    }

    return segments.join('/')
  }

  function isPreviewable(item: DocItem | null) {
    if (!item || item.type !== 'file') return false
    const mime = item.mime_type || ''
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    return mime.includes('image') || mime.includes('pdf') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'heic'].includes(ext)
  }

  function scopeLabel(item: DocItem) {
    if (item.scope_type === 'Agence') return item.agence ? `Agence • ${item.agence}` : 'Agence'
    if (item.scope_type === 'Societe') return item.societe ? `Société • ${item.societe}` : 'Société'
    return 'Global'
  }

  function isItemVisibleForVision(
    item: DocItem,
    vision: 'Global' | 'Cegeclim' | 'CVC',
    agenceFilter: string
  ) {
    const scope = item.scope_type || 'Global'

    if (scope === 'Global') {
      return agenceFilter === 'all' ? true : item.agence === agenceFilter
    }

    if (scope === 'Societe') {
      if (vision === 'Global') return agenceFilter === 'all' ? true : item.agence === agenceFilter
      if (item.societe !== vision) return false
      return agenceFilter === 'all' ? true : item.agence === agenceFilter
    }

    if (scope === 'Agence') {
      if (agenceFilter !== 'all' && item.agence !== agenceFilter) return false
      if (vision === 'Global') return true
      return item.societe === vision
    }

    return true
  }

  function isDescendantFolder(sourceId: string | null, candidateTargetId: string, allItems: DocItem[]) {
    if (!sourceId) return false
    if (sourceId === candidateTargetId) return true

    let cursor = allItems.find((x) => x.id === candidateTargetId) || null
    while (cursor) {
      if (cursor.parent_id === sourceId) return true
      cursor = allItems.find((x) => x.id === cursor?.parent_id) || null
    }
    return false
  }

  function getDescendants(folderId: string): DocItem[] {
    const result: DocItem[] = []

    function walk(parentId: string) {
      const children = items.filter((i) => i.parent_id === parentId)
      for (const child of children) {
        result.push(child)
        if (child.type === 'folder') walk(child.id)
      }
    }

    walk(folderId)
    return result
  }

  function openFolder(folderId: string) {
    setCurrentFolderId(folderId)
    setSelectedItemId(null)
  }

  async function handleCreateFolder() {
    const folderName = sanitizeName(newFolderName)

    if (!folderName) {
      setMessage('Merci de saisir un nom de dossier.')
      return
    }

    const duplicate = items.some(
      (item) =>
        item.parent_id === currentFolderId &&
        item.type === 'folder' &&
        item.name.toLowerCase() === folderName.toLowerCase()
    )

    if (duplicate) {
      setMessage('Un dossier avec ce nom existe déjà à cet emplacement.')
      return
    }

    const parentFolder = items.find((x) => x.id === currentFolderId) || null

    const { error } = await supabase.from('documents').insert({
      name: folderName,
      type: 'folder',
      parent_id: currentFolderId,
      storage_path: null,
      size: null,
      mime_type: null,
      scope_type: parentFolder?.scope_type ?? 'Global',
      societe: parentFolder?.societe ?? (visionScope === 'Global' ? null : visionScope),
      agence: parentFolder?.agence ?? (filterAgence === 'all' ? null : filterAgence),
      linked_entity_type: null,
      linked_entity_id: null,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      console.error(error)
      setMessage(`Erreur création dossier : ${error.message}`)
      return
    }

    setCreatingFolder(false)
    setNewFolderName('')
    setMessage('Dossier créé avec succès.')
    await loadDocuments()
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploading(true)
    setMessage(null)

    try {
      const parentFolder = items.find((x) => x.id === currentFolderId) || null
      const folderPath = getFolderPath(currentFolderId)

      for (const file of Array.from(files)) {
        const cleanName = sanitizeName(file.name)
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cleanName}`
        const storagePath = folderPath ? `${folderPath}/${uniqueName}` : uniqueName

        const { error: uploadError } = await supabase.storage
          .from(BUCKET_NAME)
          .upload(storagePath, file, {
            cacheControl: '3600',
            upsert: false,
            contentType: file.type || undefined,
          })

        if (uploadError) {
          console.error(uploadError)
          setMessage(`Erreur upload "${file.name}" : ${uploadError.message}`)
          continue
        }

        const { error: insertError } = await supabase.from('documents').insert({
          name: cleanName,
          type: 'file',
          parent_id: currentFolderId,
          storage_path: storagePath,
          size: file.size,
          mime_type: file.type || null,
          scope_type: parentFolder?.scope_type ?? 'Global',
          societe: parentFolder?.societe ?? (visionScope === 'Global' ? null : visionScope),
          agence: parentFolder?.agence ?? (filterAgence === 'all' ? null : filterAgence),
          linked_entity_type: null,
          linked_entity_id: null,
          updated_at: new Date().toISOString(),
        })

        if (insertError) {
          console.error(insertError)
          setMessage(`Fichier uploadé mais non enregistré en base : ${insertError.message}`)
          await supabase.storage.from(BUCKET_NAME).remove([storagePath])
          continue
        }
      }

      setMessage('Ajout de fichiers terminé.')
      await loadDocuments()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDownload(item: DocItem) {
    if (item.type !== 'file' || !item.storage_path) return

    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(item.storage_path, 60)

    if (error || !data?.signedUrl) {
      console.error(error)
      setMessage(`Impossible de générer le lien : ${error?.message ?? 'erreur inconnue'}`)
      return
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleRename(item: DocItem) {
    const clean = sanitizeName(renameValue)

    if (!clean) {
      setMessage('Le nom ne peut pas être vide.')
      return
    }

    const duplicate = items.some(
      (x) =>
        x.parent_id === item.parent_id &&
        x.id !== item.id &&
        x.name.toLowerCase() === clean.toLowerCase()
    )

    if (duplicate) {
      setMessage('Un élément avec ce nom existe déjà dans ce dossier.')
      return
    }

    const { error } = await supabase
      .from('documents')
      .update({
        name: clean,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) {
      console.error(error)
      setMessage(`Erreur renommage : ${error.message}`)
      return
    }

    setRenamingItemId(null)
    setRenameValue('')
    setMessage('Nom mis à jour.')
    await loadDocuments()
  }

  async function handleMove(item: DocItem, targetFolderId: string | null) {
    const targetFolder = targetFolderId ? items.find((x) => x.id === targetFolderId) || null : null

    const { error } = await supabase
      .from('documents')
      .update({
        parent_id: targetFolderId,
        scope_type: targetFolder?.scope_type ?? item.scope_type ?? 'Global',
        societe: targetFolder?.societe ?? item.societe,
        agence: targetFolder?.agence ?? item.agence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) {
      console.error(error)
      setMessage(`Erreur déplacement : ${error.message}`)
      return
    }

    setMovingItemId(null)
    setMoveTargetFolderId('ROOT')
    setMessage('Élément déplacé.')
    await loadDocuments()
  }

  async function handleDelete(item: DocItem) {
    const ok = window.confirm(
      item.type === 'folder'
        ? `Supprimer le dossier "${item.name}" et tout son contenu ?`
        : `Supprimer le fichier "${item.name}" ?`
    )

    if (!ok) return

    if (item.type === 'folder') {
      const descendants = getDescendants(item.id)
      const filesToDelete = descendants
        .filter((d) => d.type === 'file' && d.storage_path)
        .map((d) => d.storage_path as string)

      if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove(filesToDelete)

        if (storageError) console.error(storageError)
      }

      const idsToDelete = [item.id, ...descendants.map((d) => d.id)]
      const { error } = await supabase.from('documents').delete().in('id', idsToDelete)

      if (error) {
        console.error(error)
        setMessage(`Erreur suppression dossier : ${error.message}`)
        return
      }

      if (currentFolderId === item.id) setCurrentFolderId(item.parent_id)
      if (selectedItemId && idsToDelete.includes(selectedItemId)) setSelectedItemId(null)

      setMessage('Dossier supprimé.')
      await loadDocuments()
      return
    }

    if (item.storage_path) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([item.storage_path])

      if (storageError) {
        console.error(storageError)
        setMessage(`Erreur suppression storage : ${storageError.message}`)
        return
      }
    }

    const { error } = await supabase.from('documents').delete().eq('id', item.id)

    if (error) {
      console.error(error)
      setMessage(`Erreur suppression fichier : ${error.message}`)
      return
    }

    if (selectedItemId === item.id) setSelectedItemId(null)
    setMessage('Fichier supprimé.')
    await loadDocuments()
  }

  const isImagePreview =
    selectedItem &&
    selectedItem.type === 'file' &&
    previewUrl &&
    !selectedItem.name.toLowerCase().endsWith('.pdf') &&
    !(selectedItem.mime_type || '').includes('pdf')

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-slate-900">Documents</h1>
        </div>

        {message && (
          <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
            {message}
          </div>
        )}

        <div className="grid h-[calc(100vh-140px)] grid-rows-[32%_68%] gap-4">
          {/* BULLE HAUTE : DOSSIERS */}
          <section className="rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setCurrentFolderId(null)}
                className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Racine
              </button>

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700">
                {currentFolder?.name || 'A3C Conseil'}
              </div>

              <button
                type="button"
                onClick={() => setCreatingFolder((prev) => !prev)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                📁 Nouveau dossier
              </button>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                <select
                  value={visionScope}
                  onChange={(e) => {
                    setVisionScope(e.target.value as 'Global' | 'Cegeclim' | 'CVC')
                    setCurrentFolderId(null)
                    setSelectedItemId(null)
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="Global">Global</option>
                  <option value="Cegeclim">Cegeclim</option>
                  <option value="CVC">CVC</option>
                </select>

                <select
                  value={filterAgence}
                  onChange={(e) => {
                    setFilterAgence(e.target.value)
                    setCurrentFolderId(null)
                    setSelectedItemId(null)
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  <option value="all">Toutes les agences</option>
                  {agencesDisponibles.map((agence) => (
                    <option key={agence} value={agence}>
                      {agence}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {creatingFolder && (
              <div className="mb-4 flex flex-col gap-2 md:flex-row">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Nom du dossier"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={handleCreateFolder}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                >
                  Créer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingFolder(false)
                    setNewFolderName('')
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-700"
                >
                  Annuler
                </button>
              </div>
            )}

            <div className="grid h-[calc(100%-72px)] grid-cols-2 gap-4 overflow-auto pr-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
              {currentFolders.length > 0 ? (
                currentFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    className={`flex min-h-[120px] flex-col items-center justify-center rounded-3xl border p-4 text-center transition ${
                      currentFolderId === folder.id
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-6xl">📁</div>
                    <div className="mt-3 line-clamp-2 text-sm font-medium text-slate-700">
                      {folder.name}
                    </div>
                  </button>
                ))
              ) : (
                <div className="col-span-full flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
                  Aucun dossier
                </div>
              )}
            </div>
          </section>

          {/* BAS : 2 BULLES */}
          <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[52%_48%]">
            {/* BULLE BAS GAUCHE : FICHIERS */}
            <section className="flex min-h-0 flex-col rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="text-lg font-semibold text-slate-900">
                  {currentFolder ? `Fichiers - ${currentFolder.name}` : 'Fichiers'}
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher..."
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                  />

                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                  >
                    <option value="date-desc">Plus récents</option>
                    <option value="date-asc">Plus anciens</option>
                    <option value="name-asc">Nom A → Z</option>
                    <option value="name-desc">Nom Z → A</option>
                    <option value="size-desc">Taille décroissante</option>
                    <option value="size-asc">Taille croissante</option>
                  </select>
                </div>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                <span className="font-medium text-slate-700">Chemin :</span>
                <button
                  type="button"
                  onClick={() => setCurrentFolderId(null)}
                  className="rounded-lg px-2 py-1 text-blue-600 hover:bg-blue-50"
                >
                  Racine
                </button>
                {breadcrumb.map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <span>/</span>
                    <button
                      type="button"
                      onClick={() => setCurrentFolderId(crumb.id)}
                      className="rounded-lg px-2 py-1 text-blue-600 hover:bg-blue-50"
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-slate-200">
                <div className="grid grid-cols-[minmax(0,1.8fr)_100px_120px_170px_220px] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
                  <div>Nom</div>
                  <div>Taille</div>
                  <div>Type</div>
                  <div>Date</div>
                  <div>Actions</div>
                </div>

                <div className="h-[calc(100%-49px)] overflow-auto">
                  {loading ? (
                    <div className="p-6 text-sm text-slate-500">Chargement...</div>
                  ) : currentFolderChildren.length === 0 ? (
                    <div className="p-6 text-sm text-slate-500">Aucun élément dans ce dossier.</div>
                  ) : (
                    currentFolderChildren.map((item) => {
                      const isRenaming = renamingItemId === item.id

                      return (
                        <div
                          key={item.id}
                          className={`grid grid-cols-[minmax(0,1.8fr)_100px_120px_170px_220px] gap-2 border-b border-slate-100 px-4 py-3 text-sm ${
                            selectedItemId === item.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            {isRenaming ? (
                              <div className="flex gap-2">
                                <input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  className="w-full rounded border border-slate-300 px-2 py-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRename(item)}
                                  className="rounded bg-slate-900 px-2 py-1 text-white"
                                >
                                  OK
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  if (item.type === 'folder') {
                                    setCurrentFolderId(item.id)
                                    setSelectedItemId(null)
                                  } else {
                                    setSelectedItemId(item.id)
                                  }
                                }}
                                className="flex min-w-0 items-center gap-2 text-left"
                              >
                                <span>{getFileIcon(item)}</span>
                                <span className="truncate text-slate-800">{item.name}</span>
                              </button>
                            )}
                          </div>

                          <div className="text-slate-500">{item.type === 'folder' ? '-' : formatSize(item.size)}</div>
                          <div className="text-slate-500">{getFileTypeLabel(item)}</div>
                          <div className="text-slate-500">{formatDateShort(item.updated_at || item.created_at)}</div>

                          <div className="flex flex-wrap gap-1">
                            {item.type === 'file' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedItemId(item.id)
                                  handleDownload(item)
                                }}
                                className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-700"
                              >
                                Télécharger
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setRenamingItemId(item.id)
                                setRenameValue(item.name)
                              }}
                              className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              Renommer
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setMovingItemId(item.id)
                                setMoveTargetFolderId('ROOT')
                              }}
                              className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              Déplacer
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedItemId(item.id)
                                handleDelete(item)
                              }}
                              className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700"
                            >
                              Supprimer
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {movingItemId && (
                <div className="mt-3 flex flex-col gap-2 md:flex-row">
                  <select
                    value={moveTargetFolderId}
                    onChange={(e) => setMoveTargetFolderId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                  >
                    <option value="ROOT">Racine</option>
                    {moveTargetOptions.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      const item = items.find((x) => x.id === movingItemId)
                      if (!item) return
                      handleMove(item, moveTargetFolderId === 'ROOT' ? null : moveTargetFolderId)
                    }}
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
                  >
                    Valider
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMovingItemId(null)
                      setMoveTargetFolderId('ROOT')
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm"
                  >
                    Annuler
                  </button>
                </div>
              )}

              <div
                className={`mt-4 rounded-2xl border-2 border-dashed px-4 py-4 text-center transition ${
                  dragActive ? 'border-blue-400 bg-blue-50' : 'border-slate-300 bg-slate-50'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragActive(true)
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragActive(false)
                  handleFilesSelected(e.dataTransfer.files)
                }}
              >
                <div className="mb-3 text-sm text-slate-600">
                  Dépose tes fichiers ici ou utilise le bouton ci-dessous
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800"
                  >
                    ⬆ Ajouter des fichiers
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFilesSelected(e.target.files)}
                  />

                  <span className="text-sm text-slate-500">
                    {uploading ? 'Upload en cours...' : 'Sélection multiple possible'}
                  </span>
                </div>
              </div>
            </section>

            {/* BULLE BAS DROITE : PREVIEW */}
            <section className="flex min-h-0 flex-col rounded-[32px] border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold text-slate-900">Preview</h2>

                {isImagePreview && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-500">Zoom</span>
                    <input
                      type="range"
                      min={25}
                      max={200}
                      step={5}
                      value={previewScale}
                      onChange={(e) => setPreviewScale(Number(e.target.value))}
                    />
                    <span className="w-12 text-right text-sm text-slate-600">{previewScale}%</span>
                  </div>
                )}
              </div>

              {!selectedItem ? (
                <div className="flex h-full items-center justify-center rounded-3xl border border-slate-200 bg-slate-50 text-slate-400">
                  Sélectionne un fichier pour afficher l’aperçu
                </div>
              ) : (
                <>
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-lg font-semibold text-slate-900">{selectedItem.name}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedItem.type === 'folder' ? 'Dossier' : 'Fichier'} • {scopeLabel(selectedItem)}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                    <div className="flex h-full items-center justify-center overflow-auto p-4">
                      {selectedItem.type === 'folder' ? (
                        <div className="text-center text-slate-500">
                          <div className="text-7xl">📁</div>
                          <div className="mt-3">Aperçu non disponible pour un dossier</div>
                        </div>
                      ) : previewLoading ? (
                        <div className="text-slate-500">Chargement de l’aperçu...</div>
                      ) : isPreviewable(selectedItem) && previewUrl ? (
                        selectedItem.name.toLowerCase().endsWith('.pdf') ||
                        (selectedItem.mime_type || '').includes('pdf') ? (
                          <iframe
                            src={previewUrl}
                            title={selectedItem.name}
                            className="h-full w-full rounded-2xl bg-white"
                          />
                        ) : (
                          <img
                            src={previewUrl}
                            alt={selectedItem.name}
                            style={{ width: `${previewScale}%`, maxWidth: 'none' }}
                            className="h-auto object-contain"
                          />
                        )
                      ) : (
                        <div className="text-center text-slate-500">
                          <div className="text-7xl">📄</div>
                          <div className="mt-3">Aperçu non disponible pour ce type de fichier</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <DetailRow label="Nom" value={selectedItem.name} />
                    <DetailRow label="Type" value={getFileTypeLabel(selectedItem)} />
                    <DetailRow label="Taille" value={selectedItem.type === 'folder' ? '-' : formatSize(selectedItem.size)} />
                    <DetailRow label="Date" value={formatDate(selectedItem.updated_at || selectedItem.created_at)} />
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm text-slate-700">{value}</div>
    </div>
  )
}