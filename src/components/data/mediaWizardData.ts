import type { MediaItem } from '../types/mediaWizardTypes';

export const duplicatePhotos: MediaItem[] = [
  { id: 'photo-1', name: 'IMG_4821.JPG', detail: '3 copies · 4.8 MB each', savings: 9.6 },
  { id: 'photo-2', name: 'Beach sunset.HEIC', detail: '2 copies · 3.2 MB each', savings: 3.2 },
];

export const duplicateVideos: MediaItem[] = [
  { id: 'video-1', name: 'VID_20240812.MP4', detail: '2 copies · 182 MB each', savings: 182 },
];

export const largeVideos: MediaItem[] = [
  { id: 'large-1', name: 'Family holiday.mp4', detail: '1.2 GB · 4K · 08:42', savings: 420 },
  { id: 'large-2', name: 'Birthday party.mov', detail: '680 MB · 1080p · 04:16', savings: 210 },
  { id: 'large-3', name: 'Hiking day.mp4', detail: '340 MB · 4K · 02:51', savings: 105 },
];
