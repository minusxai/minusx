'use client';

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/kit/tooltip';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { cn } from '@/components/kit/cn';
import { QuestionContent } from '@/lib/types';
import { LuScanSearch, LuSearch, LuPlus, LuType } from 'react-icons/lu';
import { useMemo, useState, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { shallowEqual } from 'react-redux';
import { setFile } from '@/store/filesSlice';
import { FilesAPI } from '@/lib/data/files';
import { pushView } from '@/store/uiSlice';
import { createDraftFile } from '@/lib/file-state/file-state';

// FILE_TYPE_METADATA.question.color is 'accent.primary' (#2980b9) — the hover
// glow below already hardcoded that rgba, so the icon/border use the same hex.
const QUESTION_ACCENT = '#2980b9';

interface QuestionBrowserPanelProps {
  folderPath: string;
  onAddQuestion: (questionId: number) => void;
  onAddTextBlock?: () => void;
  excludedIds?: number[];
  title?: string;
  dashboardId?: number;
  compact?: boolean;
}

// Local display type that includes metadata (name) + content
interface QuestionDisplay extends QuestionContent {
  id: number;
  name: string;
}

export const QuestionBrowserPanel = ({
  folderPath,
  onAddQuestion,
  onAddTextBlock,
  excludedIds = [],
  title,
  dashboardId,
  compact = false,
}: QuestionBrowserPanelProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [questionsMap, setQuestionsMap] = useState<Record<number, QuestionDisplay>>({});
  // shallowEqual: skip re-renders when the files bag's top-level ref changes
  // but no actual entry differs (Immer-induced).
  const filesInRedux = useAppSelector(state => state.files.files, shallowEqual);
  const dispatch = useAppDispatch();

  // Load all questions from folder
  useEffect(() => {
    async function loadFolderQuestions() {
      try {
        // Get lightweight FileInfo list for all questions in folder
        const { data: questionFiles } = await FilesAPI.getFiles({
          paths: [folderPath],
          type: 'question',
          depth: 999  // All subfolders
        });

        // Separate questions already in Redux vs missing ones
        const newQuestionsMap: Record<number, QuestionDisplay> = {};
        const missingIds: number[] = [];

        questionFiles.forEach(f => {
          if (filesInRedux[f.id]) {
            // Reuse from Redux if already loaded
            const content = filesInRedux[f.id].content as QuestionContent;
            newQuestionsMap[f.id] = {
              id: f.id,
              name: f.name || 'Untitled Question',  // Use file name (metadata), not content.name
              ...content
            };
          } else {
            // Track missing IDs to fetch
            missingIds.push(f.id);
          }
        });

        // Only fetch missing questions from database
        if (missingIds.length > 0) {
          const { data: fullQuestions } = await FilesAPI.loadFiles(missingIds);

          // Dispatch to Redux (like useFile does)
          fullQuestions.forEach(q => {
            const content = q.content as QuestionContent;
            // No need to validate - name is in file.name (metadata), not content
            dispatch(setFile({
              file: { ...q, content },
              references: []
            }));
            newQuestionsMap[q.id] = {
              id: q.id,
              name: q.name || 'Untitled Question',  // Use file name (metadata), not content.name
              ...content
            };
          });
        }

        setQuestionsMap(newQuestionsMap);
      } catch (error) {
        console.error('Failed to load questions from folder:', error);
      }
    }

    loadFolderQuestions();
  }, [folderPath, dispatch]);

  // Convert map to array and filter out questions that are already in the dashboard and apply search
  const availableQuestions = useMemo(() => {
    // Convert map to array - content already includes id
    let filtered = Object.entries(questionsMap)
      .filter(([idStr]) => {
        const id = parseInt(idStr, 10);
        return !excludedIds.includes(id);
      })
      .map(([, content]) => content);

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(q =>
        (q.name?.toLowerCase().includes(query) || false) ||
        (q.description?.toLowerCase().includes(query) || false)
      );
    }

    return filtered;
  }, [questionsMap, excludedIds, searchQuery]);

  return (
    <div className="flex flex-col items-stretch gap-0 overflow-y-auto rounded-[5px] bg-card font-mono">
      {/* Title */}
      {title && (
        <div className="border-b border-border p-3">
          <p className="text-sm font-bold text-foreground">
            {title}
          </p>
        </div>
      )}

      {/* Create Question / Text Block Buttons */}
      <div className="border-b border-border p-3">
        <div className="flex flex-col items-stretch gap-2">
          <Button
            type="button"
            size="sm"
            className="w-full gap-2 bg-[#16a085] text-white hover:bg-[#16a085]/90"
            onClick={async (e) => {
              e.stopPropagation();
              if (dashboardId !== undefined) {
                const draftFileId = await createDraftFile('question', { folder: folderPath });
                dispatch(pushView({ type: 'create-question', folderPath, dashboardId, fileId: draftFileId }));
              }
            }}
            aria-label="Create New Question"
          >
            <LuPlus /> Create New Question
          </Button>
          {onAddTextBlock && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full gap-2"
              onClick={(e) => {
                e.stopPropagation();
                onAddTextBlock();
              }}
              aria-label="Add text block"
            >
              <LuType size={14} /> Add Text Block
            </Button>
          )}
        </div>
      </div>

      {/* Header */}
      {availableQuestions.length > 0 ? (
        <div>
            <div className="border-b border-border bg-muted p-4">
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Available Questions ({availableQuestions.length})
                </p>

                {/* Search Bar */}
                <div className="relative">
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <LuSearch size={14} />
                </div>
                <Input
                    placeholder="Search questions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 bg-card pl-2 text-xs md:text-xs"
                />
                </div>
            </div>

            <div className={cn('overflow-y-auto p-3', compact ? 'max-h-[200px]' : 'max-h-[320px]')}>
                {availableQuestions.length > 0 ? (
                <div className="flex flex-col items-stretch gap-2">
                    {availableQuestions.map(question => (
                    <QuestionItem
                        key={question.id}
                        question={question}
                        onAddQuestion={onAddQuestion}
                    />
                    ))}
                </div>
                ) : (
                <div className="rounded-md border border-dashed border-border p-4 text-center">
                    <p className="text-xs text-muted-foreground">
                    {searchQuery.trim() ? 'No questions match your search' : 'All questions have been added'}
                    </p>
                </div>
                )}
            </div>
        </div>)
        : (
            <div>
                <p className="p-3 text-center text-xs text-muted-foreground">
                    No new existing question in this folder.
                </p>
            </div>
        )}

    </div>
  );
};

interface QuestionItemProps {
  question: QuestionDisplay;
  onAddQuestion: (questionId: number) => void;
}

const QuestionItem = ({ question, onAddQuestion }: QuestionItemProps) => {
  return (
    <div
      role="article"
      aria-label={question.name || 'Untitled Question'}
      className="rounded-md border border-border bg-card p-3 transition-all duration-150 hover:border-[#2980b9] hover:bg-muted hover:shadow-[0_0_12px_rgba(41,128,185,0.15)]"
    >
      <div className="flex items-start gap-2.5">
        <LuScanSearch
          size={16}
          className="mt-0.5 shrink-0"
          style={{ color: QUESTION_ACCENT }}
        />
        <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="line-clamp-1 text-sm font-semibold text-foreground">
                  {question.name || 'Untitled Question'}
                </p>
              </TooltipTrigger>
              <TooltipContent>{question.name || 'Untitled Question'}</TooltipContent>
            </Tooltip>
            {question.description && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="line-clamp-2 text-xs leading-[1.4] text-muted-foreground">
                    {question.description}
                  </p>
                </TooltipTrigger>
                <TooltipContent>{question.description}</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>
        </div>
        <Button
          onClick={() => onAddQuestion(question.id)}
          aria-label="Add to dashboard"
          size="xs"
          variant="ghost"
          className="px-2 text-[#16a085] hover:bg-[#16a085]/10 hover:text-[#16a085]"
        >
          <LuPlus />
          Add
        </Button>
      </div>
    </div>
  );
};
