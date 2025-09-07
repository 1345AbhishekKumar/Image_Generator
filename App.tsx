import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { GoogleGenAI, GenerateImagesResponse } from "@google/genai";
import ReactCrop, { type Crop, centerCrop, makeAspectCrop, PixelCrop } from 'react-image-crop';

type AspectRatio = '1:1' | '16:9' | '9:16';

interface HistoryItem {
  prompt: string;
  imageUrl: string;
  aspectRatio: AspectRatio;
}

// Helper function to get a data URL for the cropped image
function getCroppedImg(
  image: HTMLImageElement,
  crop: PixelCrop
): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No 2d context');
  }

  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  
  canvas.width = Math.floor(crop.width * scaleX);
  canvas.height = Math.floor(crop.height * scaleY);

  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    crop.width * scaleX,
    crop.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL('image/jpeg', 0.9);
}


const ImageEditor: React.FC<{
  imageUrl: string;
  onSave: (newImageUrl: string) => void;
  onCancel: () => void;
}> = ({ imageUrl, onSave, onCancel }) => {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  
  const imgRef = useRef<HTMLImageElement>(null);
  
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
    const initialCrop = centerCrop(
        makeAspectCrop(
            {
                unit: '%',
                width: 90,
            },
            width / height,
            width,
            height
        ),
        width,
        height
    );
    setCrop(initialCrop);
  };

  const handleSave = () => {
    if (!imgRef.current || !completedCrop?.width || !completedCrop?.height) {
      return;
    }
    const croppedImageUrl = getCroppedImg(imgRef.current, completedCrop);
    onSave(croppedImageUrl);
  };
  
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-lg flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col p-6 border border-slate-700">
            <h2 id="editor-title" className="text-2xl font-bold text-slate-200 mb-4">Crop Image</h2>
            <div className="flex-grow flex items-center justify-center overflow-auto p-2">
                <ReactCrop 
                    crop={crop} 
                    onChange={c => setCrop(c)} 
                    onComplete={c => setCompletedCrop(c)}
                >
                     <img ref={imgRef} src={imageUrl} onLoad={handleImageLoad} alt="Image to crop" className="max-w-full max-h-[60vh] object-contain"/>
                </ReactCrop>
            </div>
            <div className="flex justify-end space-x-4 pt-6 mt-auto">
                 <button onClick={onCancel} className="px-6 py-2 rounded-lg font-semibold text-slate-300 bg-slate-600 hover:bg-slate-500 transition-colors">Cancel</button>
                 <button 
                   onClick={handleSave} 
                   disabled={!completedCrop?.width || !completedCrop?.height}
                   className="px-6 py-2 rounded-lg font-semibold text-white bg-purple-600 hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                     Save Crop
                 </button>
            </div>
        </div>
    </div>
  )
}

const ImageLightbox: React.FC<{
  imageUrl: string;
  onClose: () => void;
}> = ({ imageUrl, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-lg flex items-center justify-center z-50 p-4 sm:p-6 md:p-8 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Enlarged image view"
    >
      <div
        className="relative max-w-5xl max-h-[90vh] w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={imageUrl}
          alt="Enlarged view of the generated image"
          className="w-full h-full object-contain rounded-lg shadow-2xl"
        />
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 sm:top-0 sm:right-0 bg-slate-700 text-white rounded-full p-2 hover:bg-purple-600 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-black/50"
          aria-label="Close enlarged image view"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};


const App: React.FC = () => {
  const [prompt, setPrompt] = useState<string>('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [imageToEdit, setImageToEdit] = useState<{imageUrl: string; index: number} | null>(null);
  const [isLightboxOpen, setIsLightboxOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('ai-image-weaver-history');
      if (storedHistory) {
        // Ensure old history items have a default aspectRatio and no unsupported fields
        const parsedHistory = JSON.parse(storedHistory).map((item: any) => ({
          prompt: item.prompt,
          imageUrl: item.imageUrl,
          aspectRatio: item.aspectRatio || '1:1',
        }));
        setHistory(parsedHistory);
      }
    } catch (e) {
      console.error("Failed to load history from localStorage", e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('ai-image-weaver-history', JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save history to localStorage", e);
    }
  }, [history]);


  const ai = useMemo(() => {
    if (!process.env.API_KEY) {
      setError("API Key is missing. Please ensure it's configured in the environment.");
      return new GoogleGenAI({ apiKey: "" }); // Fallback, requests will fail
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
  }, []);

  const handleGenerateImage = useCallback(async () => {
    if (!prompt.trim()) {
      setError("Please enter a prompt to generate an image.");
      return;
    }

    if (!process.env.API_KEY) {
        setError("Image generation failed: API Key is not configured in the environment.");
        setIsLoading(false);
        return;
    }

    setIsLoading(true);
    setError(null);
    setImageUrl(null);

    try {
      const response: GenerateImagesResponse = await ai.models.generateImages({
        model: 'imagen-4.0-generate-001',
        prompt: prompt,
        config: { 
            numberOfImages: 1, 
            outputMimeType: 'image/jpeg',
            aspectRatio: aspectRatio,
        },
      });

      if (response.generatedImages && response.generatedImages.length > 0 && response.generatedImages[0].image?.imageBytes) {
        const base64ImageBytes = response.generatedImages[0].image.imageBytes;
        const newImageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;
        setImageUrl(newImageUrl);
        setHistory(prevHistory => [{ prompt, imageUrl: newImageUrl, aspectRatio }, ...prevHistory].slice(0, 50));
      } else {
        setError("No image data received. The model might not have generated an image for this prompt, or the response format is unexpected.");
      }
    } catch (e: any) {
      console.error("Error generating image:", e);
      let errorMessage = "Failed to generate image. Please try again.";
      if (e.message) {
        if (e.message.toLowerCase().includes("api key not valid") || e.message.toLowerCase().includes("api key is missing") || e.message.toLowerCase().includes("permission denied")) {
          errorMessage = "Image generation failed: The API key is invalid or missing. Please ensure it is configured correctly.";
        } else if (e.message.toLowerCase().includes("quota")) {
          errorMessage = "Image generation failed: You may have exceeded your API quota.";
        } else if (e.message.toLowerCase().includes("model_not_found")) {
            errorMessage = "Image generation failed: The specified model could not be found. Please check the model name.";
        } else if (e.message.toLowerCase().includes("billing")) {
             errorMessage = "Image generation failed due to a billing issue. Please check your account.";
        } else {
          errorMessage += ` Details: ${e.message}`;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [prompt, ai, aspectRatio]);

  const handleClear = useCallback(() => {
    setPrompt('');
    setAspectRatio('1:1');
    setImageUrl(null);
    setError(null);
    setIsLoading(false);
  }, []);

  const handleHistoryClick = useCallback((item: HistoryItem) => {
    setPrompt(item.prompt);
    setAspectRatio(item.aspectRatio || '1:1');
    setImageUrl(item.imageUrl);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const handleEditImage = () => {
    if (!imageUrl) return;
    const historyIndex = history.findIndex(h => h.imageUrl === imageUrl);
    setImageToEdit({ imageUrl, index: historyIndex });
    setIsEditing(true);
  };

  const handleSaveEdit = (newImageUrl: string) => {
    if (imageToEdit) {
      setImageUrl(newImageUrl);
      if (imageToEdit.index > -1) {
        const updatedHistory = [...history];
        updatedHistory[imageToEdit.index].imageUrl = newImageUrl;
        setHistory(updatedHistory);
      }
      setIsEditing(false);
      setImageToEdit(null);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setImageToEdit(null);
  };

  const handleDownloadImage = useCallback(() => {
    if (!imageUrl) return;

    // Sanitize the prompt to create a valid filename
    const sanitizedPrompt = prompt
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric characters except spaces and hyphens
        .replace(/\s+/g, '-') // replace spaces with hyphens
        .slice(0, 50); // limit length

    const filename = sanitizedPrompt ? `ai-image-${sanitizedPrompt}.jpeg` : `ai-image-${Date.now()}.jpeg`;

    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [imageUrl, prompt]);
  
  const openLightbox = () => {
    if(imageUrl) setIsLightboxOpen(true);
  }
  const closeLightbox = () => setIsLightboxOpen(false);


  const aspectRatioStyles = {
    '1:1': 'aspect-square max-w-xl',
    '16:9': 'aspect-video max-w-3xl',
    '9:16': 'aspect-[9/16] max-w-md'
  };

  const LoadingSpinner: React.FC = () => (
    <div className="flex flex-col items-center justify-center space-y-2" role="status" aria-label="Loading image">
      <svg className="animate-spin h-12 w-12 text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p className="text-purple-300">Generating your masterpiece...</p>
    </div>
  );
  
  const IconSparkles: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.382c-.836.067-1.171 1.079-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.572.3-1.584-.536-1.65l-4.752-.382-1.831-4.401z" clipRule="evenodd" />
    </svg>
  );

  const IconTrash: React.FC<{className?: string}> = ({className}) => (
     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
        <path d="M6.5 2a.5.5 0 00-.5.5v1a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-1a.5.5 0 00-.5-.5h-3zM8 1.5A1.5 1.5 0 019.5 0h1A1.5 1.5 0 0112 1.5v1A1.5 1.5 0 0110.5 4h-1A1.5 1.5 0 018 2.5v-1z"></path>
        <path d="M14.997 4.5a.5.5 0 00-.5-.5h-10a.5.5 0 000 1h10a.5.5 0 00.5-.5zM14 5.5a1 1 0 01-1 1h-8a1 1 0 01-1-1V4a.5.5 0 01.5-.5h9a.5.5 0 01.5.5v1.5z"></path>
        <path d="M5.5 5.5A.5.5 0 016 5h4a.5.5 0 010 1H6a.5.5 0 01-.5-.5zM1.5 7.5A.5.5 0 001 8v6a.5.5 0 00.5.5h13a.5.5 0 00.5-.5V8a.5.5 0 00-.5-.5h-13zM2 14V8h12v6H2z"></path>
    </svg>
  );

  const IconPencil: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z" />
      <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z" />
    </svg>
  );
  
  const IconDownload: React.FC<{className?: string}> = ({className}) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden="true">
        <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
        <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
    </svg>
  );


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-purple-900 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 md:p-8 font-['Inter'] selection:bg-purple-500 selection:text-white">
      {isLightboxOpen && imageUrl && (
        <ImageLightbox imageUrl={imageUrl} onClose={closeLightbox} />
      )}
      {isEditing && imageToEdit && (
        <ImageEditor
          imageUrl={imageToEdit.imageUrl}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
        />
      )}
      <div className="w-full max-w-4xl space-y-8 ">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-500 to-orange-400">
            AI Image Weaver
          </h1>
          <p className="mt-3 text-lg text-slate-400">
            Craft stunning visuals from your imagination. Just type a prompt and let AI do the magic!
          </p>
        </header>

        <main className="bg-slate-800/70 backdrop-blur-md p-6 sm:p-8 rounded-xl shadow-2xl space-y-6 border border-slate-700">
          <div className="space-y-4">
            <div>
              <label htmlFor="prompt" className="block text-sm font-medium text-purple-300 mb-1">
                Image Prompt
              </label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., A majestic cat astronaut exploring a vibrant alien jungle, digital art"
                rows={3}
                className="w-full p-3 rounded-lg bg-slate-700 border border-slate-600 focus:ring-2 focus:ring-purple-500 focus:border-transparent placeholder-slate-500 text-slate-100 resize-none transition-shadow focus:shadow-lg focus:shadow-purple-500/30"
                disabled={isLoading}
                aria-required="true"
                aria-label="Image generation prompt input"
              />
            </div>
             <div>
              <label htmlFor="aspect-ratio" className="block text-sm font-medium text-slate-400 mb-1">
                Aspect Ratio
              </label>
              <select
                id="aspect-ratio"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                disabled={isLoading}
                className="w-full p-3 rounded-lg bg-slate-700 border border-slate-600 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-slate-100 transition-shadow focus:shadow-lg focus:shadow-purple-500/30"
                aria-label="Select image aspect ratio"
              >
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row space-y-4 sm:space-y-0 sm:space-x-4">
            <button
              onClick={handleGenerateImage}
              disabled={isLoading || !prompt.trim() || !process.env.API_KEY}
              className="flex-1 group relative inline-flex items-center justify-center px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-500 hover:from-purple-700 hover:to-pink-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-purple-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-300 ease-in-out transform hover:scale-105 shadow-lg hover:shadow-xl disabled:shadow-none disabled:transform-none"
              aria-label={isLoading ? 'Generating image, please wait' : 'Generate image from prompt'}
            >
              <IconSparkles className="w-5 h-5 mr-2 transition-transform duration-500 ease-out group-hover:rotate-[360deg]" />
              {isLoading ? 'Weaving Magic...' : 'Generate Image'}
            </button>
            <button
              onClick={handleClear}
              disabled={isLoading || (!imageUrl && !error && !prompt.trim() && aspectRatio === '1:1')}
              className="flex-1 sm:flex-none group relative inline-flex items-center justify-center px-6 py-3 rounded-lg font-semibold text-slate-300 bg-slate-600 hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 ease-in-out shadow-md hover:shadow-lg disabled:shadow-none"
              aria-label="Clear prompts and generated image"
            >
              <IconTrash className="w-5 h-5 mr-2 text-slate-400 group-hover:text-slate-200" />
              Clear
            </button>
          </div>
        </main>

        <section aria-live="polite" aria-atomic="true" className={`bg-slate-800/70 backdrop-blur-md p-4 sm:p-6 rounded-xl shadow-2xl flex justify-center items-center min-h-[300px] w-full mx-auto border border-slate-700 overflow-hidden relative group transition-all duration-300 ${aspectRatioStyles[aspectRatio]}`}>
          {isLoading ? (
            <LoadingSpinner />
          ) : error ? (
            <div className="text-center text-red-400 bg-red-900/30 p-4 rounded-lg max-w-md" role="alert">
              <h3 className="font-semibold text-lg mb-1">Oops! Something went wrong.</h3>
              <p className="text-sm">{error}</p>
            </div>
          ) : imageUrl ? (
            <>
              <button 
                onClick={openLightbox} 
                className="w-full h-full flex items-center justify-center cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-slate-800 rounded-lg"
                aria-label="Enlarge generated image"
              >
                <img
                  src={imageUrl}
                  alt={prompt || "Generated image"}
                  className="rounded-lg shadow-xl max-w-full max-h-full object-contain transition-all duration-300 ease-in-out opacity-0 data-[loaded=true]:opacity-100 hover:scale-105"
                  onLoad={(e) => (e.currentTarget as HTMLImageElement).setAttribute('data-loaded', 'true')}
                />
              </button>
              <div className="absolute top-3 right-3 flex space-x-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
                <button 
                  onClick={handleDownloadImage}
                  className="bg-black/60 backdrop-blur-sm text-white p-2 rounded-full hover:bg-purple-600/80 transition-colors"
                  aria-label="Download image"
                >
                    <IconDownload className="w-5 h-5" />
                </button>
                <button 
                  onClick={handleEditImage} 
                  className="bg-black/60 backdrop-blur-sm text-white p-2 rounded-full hover:bg-purple-600/80 transition-colors"
                  aria-label="Edit image"
                >
                    <IconPencil className="w-5 h-5" />
                </button>
              </div>
            </>
          ) : (
            <div className="text-center text-slate-500">
              <IconSparkles className="w-16 h-16 mx-auto mb-4 text-slate-600" />
              <p className="font-semibold text-lg">Your masterpiece awaits!</p>
              <p className="text-sm">Enter a prompt above and click "Generate Image".</p>
            </div>
          )}
        </section>

        <section aria-labelledby="history-heading" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 id="history-heading" className="text-2xl font-bold text-slate-300">
              History
            </h2>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                disabled={isLoading}
                className="group inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold text-slate-300 bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Clear all items from history"
              >
                <IconTrash className="w-4 h-4 mr-2 text-slate-400 group-hover:text-slate-200 transition-colors" />
                Clear History
              </button>
            )}
          </div>
          {history.length > 0 ? (
            <div className="history-scrollbar flex space-x-4 overflow-x-auto pb-4 -mx-4 sm:-mx-6 px-4 sm:px-6">
              {history.map((item, index) => (
                 <button
                    key={`${index}-${item.imageUrl.slice(-10)}`}
                    onClick={() => handleHistoryClick(item)}
                    className="flex-shrink-0 w-32 sm:w-40 text-left focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-purple-500 rounded-lg group"
                    aria-label={`Reuse prompt: ${item.prompt}`}
                  >
                  <div className="relative">
                    <img src={item.imageUrl} alt={item.prompt} className="w-full h-32 sm:h-40 object-cover rounded-lg shadow-md transition-transform duration-300 group-hover:scale-105 border-2 border-transparent group-focus:border-purple-500" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                      <p className="text-white text-xs text-center p-2 font-semibold">Reuse Prompt</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 truncate group-hover:text-slate-200 transition-colors" title={item.prompt}>{item.prompt}</p>
                </button>
              ))}
            </div>
          ) : (
             <div className="text-center text-slate-500 bg-slate-800/50 p-8 rounded-xl border border-slate-700">
              <p>Your generated images will appear here.</p>
            </div>
          )}
        </section>
        
        <footer className="text-center text-sm text-slate-500 pt-4">
            <p>&copy; {new Date().getFullYear()} AI Image Weaver. Powered by Gemini.</p>
        </footer>

      </div>
    </div>
  );
};

export default App;