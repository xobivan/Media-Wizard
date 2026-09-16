import { useMemo, useState } from 'react';
import type { LargeVideo } from '../components/types/mediaWizardTypes';

export function useLargeVideoSelection() {
  const [largeVideos, setLargeVideos] = useState<LargeVideo[]>([]);
  const [selectedLarge, setSelectedLarge] = useState<string[]>([]);

  const selectedSavings = useMemo(
    () => largeVideos.filter((video) => selectedLarge.includes(video.id)).reduce((sum, video) => sum + video.savings, 0),
    [largeVideos, selectedLarge],
  );

  const toggleSelection = (id: string) => {
    setSelectedLarge((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const selectAll = () => {
    setSelectedLarge(selectedLarge.length === largeVideos.length ? [] : largeVideos.map((item) => item.id));
  };

  const updateLargeVideos = (videos: LargeVideo[]) => {
    setLargeVideos(videos);
  };

  const clearLargeVideos = () => {
    setLargeVideos([]);
    setSelectedLarge([]);
  };

  return {
    largeVideos,
    selectedLarge,
    selectedSavings,
    toggleSelection,
    selectAll,
    updateLargeVideos,
    clearLargeVideos,
    setLargeVideos,
    setSelectedLarge,
  };
}
