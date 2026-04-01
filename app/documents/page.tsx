'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type DocType = 'folder' | 'file'
type ScopeType = 'Global' | 'Societe' | 'Agence'
type SocieteType = 'Cegeclim' | 'CVC' | null
type VisionType = 'Global' | 'Cegeclim' | 'CVC'

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
  linked_entity_type?: string | null
  linked_entity_id?: string | null
}

type UserDocumentAccess = {
  email: string
  can_documents: boolean
  allowed_scopes: string[]
  allowed_agences: string[]
}

type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'date-desc'
  | 'date-asc'
  | 'size-desc'
  | 'size-asc'

const BUCKET_NAME = 'documents'
const EMPTY_MESSAGE = ''

const LIST_GRID_CLASS =
  'grid grid-cols-[minmax(260px,3fr)_110px_130px_170px_minmax(260px,1.8fr)] gap-4 xl:grid-cols-[minmax(320px,3.4fr)_120px_140px_180px_minmax(300px,2fr)]'

export default function DocumentsPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [items, setItems] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)

  const [access, setAccess] = useState<UserDocumentAccess | null>(null)

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const [message, setMessage] = useState(EMPTY_MESSAGE)
  const [errorMessage, setErrorMessage] = useState(EMPTY_MESSAGE)

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

  const [visionScope, setVisionScope] = useState<VisionType>('Global')
  const [filterAgence, setFilterAgence] = useState<string>('all')

  const [dragActive, setDragActive] = useState(false)

  useEffect(() => {
    void initializePage()
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

    void loadPreviewUrl(item)
  }, [selectedItemId, items])

  async function initializePage() {
    setLoading(true)
    setAuthLoading(true)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user?.email) {
      router.replace('/login')
      return
    }

    const normalizedEmail = user.email.toLowerCase().trim()

    const { data: accessRow, error: accessError } = await supabase
      .from('user_page_access')
      .select('email, can_documents, allowed_scopes, allowed_agences')
      .eq('email', normalizedEmail)
      .maybeSingle()

    if (accessError) {
      setErrorMessage(`Erreur lecture des droits : ${accessError.message}`)
      setLoading(false)
      setAuthLoading(false)
      return
    }

    if (!accessRow || !accessRow.can_documents) {
      router.replace('/unauthorized')
      return
    }

    const accessData: UserDocumentAccess = {
      email: normalizedEmail,
      can_documents: !!accessRow.can_documents,
      allowed_scopes:
        Array.isArray(accessRow.allowed_scopes) && accessRow.allowed_scopes.length > 0
          ? accessRow.allowed_scopes
          : ['Global'],
      allowed_agences:
        Array.isArray(accessRow.allowed_agences) && accessRow.allowed_agences.length > 0
          ? accessRow.allowed_agences
          : [],
    }

    setAccess(accessData)
    setAuthLoading(false)

    const preferredVision = getDefaultVision(accessData)
    setVisionScope(preferredVision)

    await loadDocuments(accessData)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  async function loadDocuments(currentAccess?: UserDocumentAccess) {
    setLoading(true)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    const activeAccess = currentAccess ?? access
    if (!activeAccess) {
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .order('type', { ascending: false })
      .order('updated_at', { ascending: false })

    if (error) {
      setErrorMessage(`Erreur chargement documents : ${error.message}`)
      setItems([])
      setLoading(false)
      return
    }

    const rows = ((data || []) as DocItem[]).map((row) => ({
      ...row,
      scope_type: row.scope_type ?? 'Global',
      societe: row.societe ?? null,
      agence: row.agence ?? null,
      updated_at: row.updated_at ?? row.created_at ?? null,
    }))

    const securedRows = rows.filter((item) => isDocumentAllowedForUser(item, activeAccess))

    setItems(securedRows)

    if (selectedItemId && !securedRows.some((x) => x.id === selectedItemId)) {
      setSelectedItemId(null)
    }

    if (currentFolderId && !securedRows.some((x) => x.id === currentFolderId)) {
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

  const authorizedVisionOptions = useMemo(() => {
    if (!access) return ['Global'] as VisionType[]

    const options: VisionType[] = ['Global']

    if (access.allowed_scopes.includes('Global') || access.allowed_scopes.includes('Cegeclim')) {
      options.push('Cegeclim')
    }

    if (access.allowed_scopes.includes('Global') || access.allowed_scopes.includes('CVC')) {
      options.push('CVC')
    }

    return Array.from(new Set(options))
  }, [access])

  const agencesDisponibles = useMemo(() => {
    const values = items
      .map((x) => x.agence)
      .filter((x): x is string => Boolean(x && x.trim()))
      .filter((agence) => {
        if (!access) return false
        if (access.allowed_agences.length === 0) return true
        return access.allowed_agences.includes(agence)
      })
      .sort((a, b) => a.localeCompare(b, 'fr'))

    return Array.from(new Set(values))
  }, [items, access])

  const uiFilteredItems = useMemo(() => {
    return items.filter((item) => {
      if (visionScope === 'Cegeclim') {
        if (item.scope_type === 'Societe' && item.societe !== 'Cegeclim') return false
        if (item.scope_type === 'Agence' && item.societe !== 'Cegeclim') return false
      }

      if (visionScope === 'CVC') {
        if (item.scope_type === 'Societe' && item.societe !== 'CVC') return false
        if (item.scope_type === 'Agence' && item.societe !== 'CVC') return false
      }

      if (filterAgence !== 'all') {
        return item.agence === filterAgence
      }

      return true
    })
  }, [items, visionScope, filterAgence])

  const itemsByParent = useMemo(() => {
    const map = new Map<string | null, DocItem[]>()

    for (const item of uiFilteredItems) {
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
  }, [uiFilteredItems])

  const topFolders = useMemo(() => {
    return (itemsByParent.get(currentFolderId ?? null) || []).filter((x) => x.type === 'folder')
  }, [itemsByParent, currentFolderId])

  const currentFolderChildren = useMemo(() => {
    let children = [...(itemsByParent.get(currentFolderId ?? null) || [])]

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
          return (
            new Date(b.updated_at || b.created_at || 0).getTime() -
            new Date(a.updated_at || a.created_at || 0).getTime()
          )
        case 'date-asc':
          return (
            new Date(a.updated_at || a.created_at || 0).getTime() -
            new Date(b.updated_at || b.created_at || 0).getTime()
          )
        case 'size-desc':
          return (b.size || 0) - (a.size || 0)
        case 'size-asc':
          return (a.size || 0) - (b.size || 0)
        default:
          return 0
      }
    })

    return children
  }, [itemsByParent, currentFolderId, search, sortBy])

  const selectedItem = useMemo(() => {
    return uiFilteredItems.find((item) => item.id === selectedItemId) || null
  }, [uiFilteredItems, selectedItemId])

  const currentFolder = useMemo(() => {
    return uiFilteredItems.find((x) => x.id === currentFolderId) || null
  }, [uiFilteredItems, currentFolderId])

  const breadcrumb = useMemo(() => {
    const result: DocItem[] = []
    let cursor = uiFilteredItems.find((i) => i.id === currentFolderId) || null

    while (cursor) {
      result.unshift(cursor)
      cursor = uiFilteredItems.find((i) => i.id === cursor?.parent_id) || null
    }

    return result
  }, [uiFilteredItems, currentFolderId])

  const moveTargetOptions = useMemo(() => {
    return uiFilteredItems
      .filter(
        (x) =>
          x.type === 'folder' &&
          x.id !== movingItemId &&
          !isDescendantFolder(movingItemId, x.id, uiFilteredItems)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [uiFilteredItems, movingItemId])

  function getDefaultVision(currentAccess: UserDocumentAccess): VisionType {
    if (currentAccess.allowed_scopes.includes('Global')) return 'Global'
    if (currentAccess.allowed_scopes.includes('Cegeclim')) return 'Cegeclim'
    if (currentAccess.allowed_scopes.includes('CVC')) return 'CVC'
    return 'Global'
  }

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
    if (item.type === 'folder') return '🗂️'
    const ext = item.name.split('.').pop()?.toLowerCase()

    if (ext === 'pdf') return '📕'
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return '📗'
    if (['doc', 'docx', 'ppt', 'pptx'].includes(ext || '')) return '📘'
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext || '')) return '🖼️'
    if (['zip', 'rar', '7z'].includes(ext || '')) return '🗜️'
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

  function scopeLabel(item: DocItem) {
    if (item.scope_type === 'Agence') return item.agence ? `Agence • ${item.agence}` : 'Agence'
    if (item.scope_type === 'Societe') return item.societe ? `Société • ${item.societe}` : 'Société'
    return 'Global'
  }

  function isPreviewable(item: DocItem | null) {
    if (!item || item.type !== 'file') return false
    const mime = item.mime_type || ''
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    return (
      mime.includes('image') ||
      mime.includes('pdf') ||
      ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'heic'].includes(ext)
    )
  }

  function isDocumentAllowedForUser(item: DocItem, userAccess: UserDocumentAccess) {
    if (!userAccess.can_documents) return false

    const hasGlobal = userAccess.allowed_scopes.includes('Global')
    const allowedScopes = userAccess.allowed_scopes
    const allowedAgences = userAccess.allowed_agences

    if (item.scope_type === 'Global' || !item.scope_type) {
      return true
    }

    if (item.scope_type === 'Societe') {
      if (hasGlobal) return true
      return !!item.societe && allowedScopes.includes(item.societe)
    }

    if (item.scope_type === 'Agence') {
      const companyOk = hasGlobal || (!!item.societe && allowedScopes.includes(item.societe))
      if (!companyOk) return false

      if (!item.agence) return true
      if (allowedAgences.length === 0) return true
      return allowedAgences.includes(item.agence)
    }

    return false
  }

  function canUseScope(scope: VisionType) {
    if (!access) return false
    if (scope === 'Global') return true
    if (access.allowed_scopes.includes('Global')) return true
    return access.allowed_scopes.includes(scope)
  }

  function canAssignDocumentContext(
    scopeType: ScopeType,
    societe: SocieteType,
    agence: string | null
  ) {
    if (!access) return false

    if (scopeType === 'Global') return true

    if (scopeType === 'Societe') {
      if (!societe) return false
      return access.allowed_scopes.includes('Global') || access.allowed_scopes.includes(societe)
    }

    if (scopeType === 'Agence') {
      if (!societe) return false

      const companyOk =
        access.allowed_scopes.includes('Global') || access.allowed_scopes.includes(societe)

      if (!companyOk) return false

      if (!agence) return false
      if (access.allowed_agences.length === 0) return true
      return access.allowed_agences.includes(agence)
    }

    return false
  }

  function inferCurrentContext(): {
    scope_type: ScopeType
    societe: SocieteType
    agence: string | null
  } {
    const parentFolder = items.find((x) => x.id === currentFolderId) || null

    if (parentFolder) {
      return {
        scope_type: parentFolder.scope_type ?? 'Global',
        societe: parentFolder.societe ?? null,
        agence: parentFolder.agence ?? null,
      }
    }

    if (filterAgence !== 'all') {
      return {
        scope_type: 'Agence',
        societe: visionScope === 'Global' ? null : visionScope,
        agence: filterAgence,
      }
    }

    if (visionScope === 'Cegeclim' || visionScope === 'CVC') {
      return {
        scope_type: 'Societe',
        societe: visionScope,
        agence: null,
      }
    }

    return {
      scope_type: 'Global',
      societe: null,
      agence: null,
    }
  }

  function isDescendantFolder(
    sourceId: string | null,
    candidateTargetId: string,
    allItems: DocItem[]
  ) {
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
      setErrorMessage('Merci de saisir un nom de dossier.')
      return
    }

    const duplicate = items.some(
      (item) =>
        item.parent_id === currentFolderId &&
        item.type === 'folder' &&
        item.name.toLowerCase() === folderName.toLowerCase()
    )

    if (duplicate) {
      setErrorMessage('Un dossier avec ce nom existe déjà à cet emplacement.')
      return
    }

    const context = inferCurrentContext()

    if (!canAssignDocumentContext(context.scope_type, context.societe, context.agence)) {
      setErrorMessage("Vous n'avez pas les droits pour créer un dossier dans ce périmètre.")
      return
    }

    const { error } = await supabase.from('documents').insert({
      name: folderName,
      type: 'folder',
      parent_id: currentFolderId,
      storage_path: null,
      size: null,
      mime_type: null,
      scope_type: context.scope_type,
      societe: context.societe,
      agence: context.agence,
      updated_at: new Date().toISOString(),
    })

    if (error) {
      setErrorMessage(`Erreur création dossier : ${error.message}`)
      return
    }

    setCreatingFolder(false)
    setNewFolderName('')
    setMessage('Dossier créé avec succès.')
    setErrorMessage(EMPTY_MESSAGE)
    await loadDocuments()
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return

    setUploading(true)
    setMessage(EMPTY_MESSAGE)
    setErrorMessage(EMPTY_MESSAGE)

    try {
      const context = inferCurrentContext()

      if (!canAssignDocumentContext(context.scope_type, context.societe, context.agence)) {
        setErrorMessage("Vous n'avez pas les droits pour ajouter des fichiers dans ce périmètre.")
        return
      }

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
          setErrorMessage(`Erreur upload "${file.name}" : ${uploadError.message}`)
          continue
        }

        const { error: insertError } = await supabase.from('documents').insert({
          name: cleanName,
          type: 'file',
          parent_id: currentFolderId,
          storage_path: storagePath,
          size: file.size,
          mime_type: file.type || null,
          scope_type: context.scope_type,
          societe: context.societe,
          agence: context.agence,
          updated_at: new Date().toISOString(),
        })

        if (insertError) {
          await supabase.storage.from(BUCKET_NAME).remove([storagePath])
          setErrorMessage(`Fichier uploadé mais non enregistré : ${insertError.message}`)
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
      setErrorMessage(`Impossible de générer le lien : ${error?.message ?? 'erreur inconnue'}`)
      return
    }

    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleRename(item: DocItem) {
    const clean = sanitizeName(renameValue)

    if (!clean) {
      setErrorMessage('Le nom ne peut pas être vide.')
      return
    }

    const duplicate = items.some(
      (x) =>
        x.parent_id === item.parent_id &&
        x.id !== item.id &&
        x.name.toLowerCase() === clean.toLowerCase()
    )

    if (duplicate) {
      setErrorMessage('Un élément avec ce nom existe déjà dans ce dossier.')
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
      setErrorMessage(`Erreur renommage : ${error.message}`)
      return
    }

    setRenamingItemId(null)
    setRenameValue('')
    setMessage('Nom mis à jour.')
    setErrorMessage(EMPTY_MESSAGE)
    await loadDocuments()
  }

  async function handleMove(item: DocItem, targetFolderId: string | null) {
    const targetFolder = targetFolderId ? items.find((x) => x.id === targetFolderId) || null : null

    const nextScopeType = (targetFolder?.scope_type ?? item.scope_type ?? 'Global') as ScopeType
    const nextSociete = (targetFolder?.societe ?? item.societe ?? null) as SocieteType
    const nextAgence = targetFolder?.agence ?? item.agence ?? null

    if (!canAssignDocumentContext(nextScopeType, nextSociete, nextAgence)) {
      setErrorMessage("Vous n'avez pas les droits pour déplacer cet élément vers ce périmètre.")
      return
    }

    const { error } = await supabase
      .from('documents')
      .update({
        parent_id: targetFolderId,
        scope_type: nextScopeType,
        societe: nextSociete,
        agence: nextAgence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)

    if (error) {
      setErrorMessage(`Erreur déplacement : ${error.message}`)
      return
    }

    setMovingItemId(null)
    setMoveTargetFolderId('ROOT')
    setMessage('Élément déplacé.')
    setErrorMessage(EMPTY_MESSAGE)
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
        await supabase.storage.from(BUCKET_NAME).remove(filesToDelete)
      }

      const idsToDelete = [item.id, ...descendants.map((d) => d.id)]
      const { error } = await supabase.from('documents').delete().in('id', idsToDelete)

      if (error) {
        setErrorMessage(`Erreur suppression dossier : ${error.message}`)
        return
      }

      if (currentFolderId === item.id) setCurrentFolderId(item.parent_id)
      if (selectedItemId && idsToDelete.includes(selectedItemId)) setSelectedItemId(null)

      setMessage('Dossier supprimé.')
      setErrorMessage(EMPTY_MESSAGE)
      await loadDocuments()
      return
    }

    if (item.storage_path) {
      const { error: storageError } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([item.storage_path])

      if (storageError) {
        setErrorMessage(`Erreur suppression storage : ${storageError.message}`)
        return
      }
    }

    const { error } = await supabase.from('documents').delete().eq('id', item.id)

    if (error) {
      setErrorMessage(`Erreur suppression fichier : ${error.message}`)
      return
    }

    if (selectedItemId === item.id) setSelectedItemId(null)
    setMessage('Fichier supprimé.')
    setErrorMessage(EMPTY_MESSAGE)
    await loadDocuments()
  }

  const isImagePreview =
    selectedItem &&
    selectedItem.type === 'file' &&
    previewUrl &&
    !selectedItem.name.toLowerCase().endsWith('.pdf') &&
    !(selectedItem.mime_type || '').includes('pdf')

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          Chargement des droits...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1800px]">
        {message && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        {errorMessage && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <div className="grid h-[calc(100vh-140px)] grid-rows-[32%_68%] gap-4">
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
                    const nextValue = e.target.value as VisionType
                    if (!canUseScope(nextValue)) return
                    setVisionScope(nextValue)
                    setCurrentFolderId(null)
                    setSelectedItemId(null)
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none"
                >
                  {authorizedVisionOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
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
                  onClick={() => void handleCreateFolder()}
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
              {topFolders.length > 0 ? (
                topFolders.map((folder) => (
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
                    <div className="text-6xl">🗂️</div>
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

          <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[40%_60%]">
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
                <div className={`${LIST_GRID_CLASS} border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500`}>
                  <div className="min-w-0">Nom</div>
                  <div className="text-left">Taille</div>
                  <div className="text-left">Type</div>
                  <div className="text-left">Date</div>
                  <div className="min-w-0 text-left">Actions</div>
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
                          className={`${LIST_GRID_CLASS} border-b border-slate-100 px-4 py-3 text-sm ${
                            selectedItemId === item.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            {isRenaming ? (
                              <div className="flex min-w-0 gap-2">
                                <input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  className="w-full min-w-0 rounded border border-slate-300 px-2 py-1"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleRename(item)}
                                  className="shrink-0 rounded bg-slate-900 px-2 py-1 text-white"
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
                                    onDoubleClick={() => {
                                    if (item.type === 'folder') {
                                    setCurrentFolderId(item.id)
                                    setSelectedItemId(null)
                                    } else {
                                    void handleDownload(item)
                                    }
                                    }}
                                className="flex w-full min-w-0 items-center gap-2 text-left"
                              >
                                <span className="shrink-0 text-base">{getFileIcon(item)}</span>
                                <span
                                  className="block min-w-0 truncate font-medium text-slate-800"
                                  title={item.name}
                                >
                                  {item.name}
                                </span>
                              </button>
                            )}
                          </div>

                          <div className="min-w-0 whitespace-nowrap text-xs text-slate-500 sm:text-sm">
                            {item.type === 'folder' ? '-' : formatSize(item.size)}
                          </div>

                          <div className="min-w-0 truncate text-xs text-slate-500 sm:text-sm">
                            {getFileTypeLabel(item)}
                          </div>

                          <div className="min-w-0 whitespace-nowrap text-xs text-slate-500 sm:text-sm">
                            {formatDateShort(item.updated_at || item.created_at)}
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-1.5">
                              {item.type === 'file' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedItemId(item.id)
                                    void handleDownload(item)
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
                                  void handleDelete(item)
                                }}
                                className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700"
                              >
                                Supprimer
                              </button>
                            </div>
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
                      void handleMove(item, moveTargetFolderId === 'ROOT' ? null : moveTargetFolderId)
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
                  void handleFilesSelected(e.dataTransfer.files)
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
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                  >
                    ⬆ Ajouter des fichiers
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleFilesSelected(e.target.files)}
                  />

                  <span className="text-sm text-slate-500">
                    {uploading ? 'Upload en cours...' : 'Sélection multiple possible'}
                  </span>
                </div>
              </div>
            </section>

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
                    <div className="break-words text-lg font-semibold text-slate-900">
                      {selectedItem.name}
                    </div>
                    <div className="mt-1 text-sm text-slate-500">
                      {selectedItem.type === 'folder' ? 'Dossier' : 'Fichier'} • {scopeLabel(selectedItem)}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50">
                    <div className="flex h-full items-center justify-center overflow-auto p-4">
                      {selectedItem.type === 'folder' ? (
                        <div className="text-center text-slate-500">
                          <div className="text-7xl">🗂️</div>
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
                    <DetailRow
                      label="Taille"
                      value={selectedItem.type === 'folder' ? '-' : formatSize(selectedItem.size)}
                    />
                    <DetailRow
                      label="Date"
                      value={formatDate(selectedItem.updated_at || selectedItem.created_at)}
                    />
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