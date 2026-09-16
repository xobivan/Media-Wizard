import * as MediaLibrary from 'expo-media-library/legacy';
import { useCallback, useState } from 'react';

export function useAlbumSelection() {
  const [source, setSource] = useState('Entire library');
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<MediaLibrary.Album | null>(null);

  const chooseFolder = useCallback(async () => {
    setSource('Choose a folder');
    const availableAlbums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    setAlbums(availableAlbums.filter((album) => album.assetCount > 0));
    setAlbumPickerVisible(true);
  }, []);

  const selectLibrary = useCallback(() => {
    setSource('Entire library');
    setSelectedAlbum(null);
    setAlbumPickerVisible(false);
  }, []);

  const selectAlbum = useCallback((album: MediaLibrary.Album) => {
    setSelectedAlbum(album);
    setSource('Choose a folder');
    setAlbumPickerVisible(false);
  }, []);

  const closeAlbumPicker = useCallback(() => {
    setAlbumPickerVisible(false);
  }, []);

  return {
    source,
    albums,
    albumPickerVisible,
    selectedAlbum,
    chooseFolder,
    selectLibrary,
    selectAlbum,
    closeAlbumPicker,
  };
}
