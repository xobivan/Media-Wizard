import type * as MediaLibrary from 'expo-media-library/legacy';

export type ResultTab = 'Photos' | 'Videos' | 'Large files';
export type PermissionState = 'checking' | 'granted' | 'limited' | 'denied';
export type ScanState = 'idle' | 'scanning' | 'complete' | 'error';
export type ScanSummary = { photos: number; videos: number; total: number };
export type MediaItem = { id: string; name: string; detail: string; savings: number };
export type LargeVideo = MediaItem & { size: number; duration: number };
export type Album = MediaLibrary.Album;
