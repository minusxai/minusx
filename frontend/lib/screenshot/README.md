# Screenshot Capture System

A lightweight client-side screenshot system for capturing FileView components (questions and dashboards).

## Features

- **Client-side capture** using `html-to-image` (fast, secure, no backend required)
- **Native canvas support** - ECharts work out-of-the-box
- **Retina quality** - 2x pixel ratio for crisp screenshots
- **Color mode aware** - Captures correct background for dark/light themes
- **Multiple output formats** - PNG (default), JPEG, Blob, or base64 dataURL
- **FileView targeting** - Automatically finds elements by `data-file-id` attribute

## Usage

### Basic Screenshot (Download)

```typescript
import { useScreenshot } from '@/lib/hooks/useScreenshot';

function MyComponent({ fileId }: { fileId: number }) {
  const { captureFileView, download } = useScreenshot();
  const [isCapturing, setIsCapturing] = useState(false);

  const handleScreenshot = async () => {
    setIsCapturing(true);
    try {
      const blob = await captureFileView(fileId);
      download(blob, `screenshot-${fileId}.png`);
    } catch (error) {
      console.error('Screenshot failed:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  return <Button onClick={handleScreenshot} loading={isCapturing}>Export PNG</Button>;
}
```

### Screenshot for Chat/API Upload

The hook returns raw Blobs that can be used for any purpose:

```typescript
const { captureFileView, blobToDataURL } = useScreenshot();

// Capture and convert to base64 for API upload
const blob = await captureFileView(fileId);
const dataURL = await blobToDataURL(blob); // "data:image/png;base64,..."

// Send to API
await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({
    message: "Here's the current view",
    image: dataURL
  })
});

// Or use FormData for multipart upload
const formData = new FormData();
formData.append('screenshot', blob, 'screenshot.png');
await fetch('/api/upload', { method: 'POST', body: formData });
```

### Advanced: Custom Element Capture

```typescript
const { captureElement } = useScreenshot();

// Capture any DOM element by ref
const elementRef = useRef<HTMLDivElement>(null);
const blob = await captureElement(elementRef.current);
```

### Advanced: Custom Options

```typescript
const { captureFileView } = useScreenshot({
  pixelRatio: 3,              // Higher quality (default: 2)
  backgroundColor: '#ffffff',  // Override background
  format: 'jpeg',             // JPEG instead of PNG
  quality: 0.9,               // JPEG quality (0-1)
  filter: (node) => !node.classList.contains('exclude') // Exclude elements
});
```

## Architecture

### File-Based Targeting

Screenshots are captured by file ID using `data-file-id` attributes:

1. **View components** add `data-file-id={fileId}` to their root element
   - `QuestionViewV2.tsx` - Question pages
   - `DashboardView.tsx` - Dashboard pages

2. **Hook** uses `document.querySelector('[data-file-id="123"]')` to find the element

3. **Capture** converts the element to PNG using `html-to-image`

### UI Integration

The "Export PNG" button is integrated into `DocumentHeader.tsx`:
- Shows in **view mode** for questions and dashboards
- Hidden in **edit mode**
- Located next to Edit/Cancel buttons
- Shows loading state during capture

### Dependencies

- **html-to-image** (v1.11.x, ~40KB) - Fast, TypeScript-native, excellent canvas support

## Performance

- **Question view** (single chart): ~300-500ms
- **Dashboard view** (4 charts): ~800-1500ms
- **Memory usage**: 30-70MB during capture (temporary)
- **Output size**: 200KB - 2MB depending on content

## Browser Support

Works in all modern browsers that support:
- Canvas API
- Blob API
- FileReader API (for dataURL conversion)

## Future Enhancements

- Server-side rendering for scheduled exports
- PDF export for multi-page reports
- Batch export for folders
- Custom crop regions
- Annotation tools
