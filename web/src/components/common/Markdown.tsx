import React, { useEffect, useState, useMemo } from 'react';
import MarkdownComponent from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './ChatContent.css'
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { Image, Box, Collapse, Tag, TagLabel, TagLeftIcon, Button, IconButton, Icon, HStack, Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, useDisclosure, Tooltip } from "@chakra-ui/react"
import { useSelector } from 'react-redux'
import { RootState } from '../../state/store'
import { renderString } from '../../helpers/templatize'
import { getOrigin, getParsedIframeInfo } from '../../helpers/origin'
import { getApp } from '../../helpers/app'
import { getAllTemplateTagsInQuery, replaceLLMFriendlyIdentifiersInSqlWithModels } from 'apps'
import type { MetabaseModel, MetabaseContext } from 'apps/types'
import { type EmbedConfigs } from '../../state/configs/reducer'
import { Badge } from "@chakra-ui/react";
import { CodeBlock } from './CodeBlock';
import { BiChevronDown, BiChevronRight, BiExpand } from 'react-icons/bi';
import { BsBarChartFill } from "react-icons/bs";
import { dispatch } from '../../state/dispatch';
import { updateIsDevToolsOpen  } from '../../state/settings/reducer';
import { setMinusxMode } from '../../app/rpc';
import { createMentionItems, MentionItem } from '../../helpers/mentionUtils';


function LinkRenderer(props: any) {
    if (props.children.toString().includes('Card ID')) {
        return (
            <a href={props.href} target="_blank" rel="minusxapp">
                {/* <Button leftIcon={<BsBarChartFill />} size={"xs"} colorScheme={"minusxGreen"}>{props.children}</Button> */}
                <Tag size='sm'  bg='minusxBW.600' variant='solid' aria-label='card-link'>
                    <TagLeftIcon as={BsBarChartFill} />
                    <TagLabel>{props.children}</TagLabel>
                </Tag>
            </a>
        )
    } 
    return (
    <a href={props.href} target="_blank" rel="minusxapp" style={{color: '#5f27cd'}}>
      <u>{props.children}</u>
    </a>
  );
}


function ModifiedParagraph(props: any) {

    return (
        <p style={{margin: '3px', wordBreak: 'break-word', overflowWrap: 'break-word', wordWrap: 'break-word', whiteSpace: 'normal', hyphens: 'auto'}}>
            {props.children}
        </p>
    )
}

function ModifiedUL(props: any) {
  return (
    <ul style={{padding: '0px 25px'}}>{props.children}</ul>
  )
}

function ModifiedOL(props: any) {
  return (
    <ol style={{padding: '0px 20px', margin: '5px'}}>{props.children}</ol>
  )
}

function HorizontalLine() {
    return (
        <hr style={{borderTop: '1px solid #c6c1be', marginTop: '20px'}} />
    )
}

function ModifiedPre(props: any) {
    return (
        <pre style={{fontSize: '0.9em', whiteSpace: 'break-spaces', margin: '0px'}} className="code">
            {props.children}
        </pre>
    )
}

function ModifiedCode(props: any) {
    const [isOpen, setIsOpen] = useState(true);
    
    if (!props.className) { // inline code
        const text = props.children?.toString() || '';
        
        if (text.startsWith('[badge]')) {
            return <Badge color={"minusxBW.600"} aria-label='mx-badge'>{text.replace('[badge]', '')}</Badge>;
        }
        if (text.startsWith('[badge_mx]')) {
            return <><Badge aria-label='mx-badge' borderLeftColor={"minusxBW.600"} borderLeft={"2px solid"} color={"minusxBW.600"} fontSize={"xs"} mt={2}>{text.replace('[badge_mx]', '')}</Badge><br></br></>;
        }
        if (text.startsWith('[mention:table:')) {
          const tableName = text.replace('[mention:table:', '').replace(']', '');
          const mentionItem = (props as any).mentionItems?.find((item: MentionItem) => 
            item.name === tableName && item.type === 'table'
          );
          
          let tooltipText = '';
          if (mentionItem) {
            tooltipText = `Name: ${mentionItem.originalName}`;
            if (mentionItem.schema) tooltipText += ` | Schema: ${mentionItem.schema}`;
          }
          
          return (
            <Tooltip label={tooltipText} placement="top" hasArrow>
              <span style={{ color: '#3182ce', fontWeight: 500 }}>
                @{tableName}
              </span>
            </Tooltip>
          );
        }
        if (text.startsWith('[mention:model:')) {
          const modelName = text.replace('[mention:model:', '').replace(']', '');
          const mentionItem = (props as any).mentionItems?.find((item: MentionItem) => 
            item.name === modelName && item.type === 'model'
          );
          
          let tooltipText = '';
          if (mentionItem) {
            tooltipText = `Name: ${mentionItem.originalName}`;
            if (mentionItem.collection) tooltipText += ` | Collection: ${mentionItem.collection}`;
          }
          
          return (
            <Tooltip label={tooltipText} placement="top" hasArrow>
              <span style={{ color: '#805ad5', fontWeight: 500 }}>
                @{modelName}
              </span>
            </Tooltip>
          );
        }
        if (text.startsWith('[mention:missing:')) {
          const parts = text.replace('[mention:missing:', '').replace(']', '').split(':');
          const type = parts[0];
          const id = parts[1];
          return (
            <span style={{ color: '#718096' }}>
              @[{type}:{id}]
            </span>
          );
        }
    }
    
    // For code blocks, wrap in collapsible component
    return (
        <Box>
            <Button
                onClick={() => setIsOpen(!isOpen)}
                size="xs"
                variant="solid"
                my={1}
                colorScheme="minusxGreen"
                border={"1px solid #eee"}
                rightIcon={<span>{isOpen ? <BiChevronDown/> : <BiChevronRight/>}</span>}
            >
                {isOpen ? 'Hide' : 'Show'} Code Block
            </Button>
            <Collapse in={isOpen} animateOpacity>
                <CodeBlock code={props.children?.toString() || ''} tool='metabase' language='sql'/>
            </Collapse>
        </Box>
    );
};

// Helper function to extract text content from React children
function getTextFromChildren(children: any): string {
    if (typeof children === 'string') {
        return children;
    }
    if (typeof children === 'number') {
        return children.toString();
    }
    if (Array.isArray(children)) {
        return children.map(getTextFromChildren).join('');
    }
    if (children && typeof children === 'object' && children.props) {
        return getTextFromChildren(children.props.children);
    }
    return '';
}

function ModifiedBlockquote(props: any) {
    const textContent = getTextFromChildren(props.children);
    const isError = textContent.toLowerCase().includes('error');
    const isWarning = textContent.toLowerCase().includes('user cancellation');

    return (
        <blockquote style={{
            borderLeft: '4px solid', 
            borderLeftColor: isError ? '#e53e3e' : isWarning ? '#d69e2e' : '#14a085', 
            borderRadius: '2px 0 0 2px',
            paddingLeft: '16px', 
            margin: '0px',
            fontStyle: 'italic'
        }}>
            {props.children}
        </blockquote>
    )
}

function ModifiedH1(props: any) {
    return (
        <h1 style={{'margin': '0px'}}>
            {props.children}
        </h1>
    )
}

function ModifiedH2(props: any) {
    return (
        <h2 style={{'margin': '0px'}}>
            {props.children}
        </h2>
    )
}

function ModifiedH3(props: any) {
    return (
        <h3 style={{'margin': '0px'}}>
            {props.children}
        </h3>
    )
}


function ModifiedH4(props: any) {
    return (
        <h4 style={{'margin': '0px'}}>
            {props.children}
        </h4>
    )
}

function ModifiedTable(props: any) {
    const { isOpen: isModalOpen, onOpen: onModalOpen, onClose: onModalClose } = useDisclosure();
    
    const handleModalOpen = () => {
        console.log('Tasks modal opened');
        dispatch(updateIsDevToolsOpen(true));
        setMinusxMode('open-sidepanel-devtools')
        onModalOpen();
      };
    
      const handleModalClose = () => {
        console.log('Tasks modal closed');
        dispatch(updateIsDevToolsOpen(false));
        setMinusxMode('open-sidepanel')
        onModalClose();
      };
    
    
    

    const isEmpty = !props.children || (Array.isArray(props.children) && props.children.length === 0);
    const isStarting = false; // Tables don't have a "starting" state like tasks

    // Calculate rows for display limiting
    const getProcessedTableChildren = () => {
        if (!props.children || isEmpty) return props.children;
        
        const children = Array.isArray(props.children) ? props.children : [props.children];
        let thead: any = null;
        let tbody: any = null;
        let totalRows = 0;
        
        // Find thead and tbody
        children.forEach((child: any) => {
            if (child?.type?.name === 'ModifiedThead') {
                thead = child;
            } else if (child?.type?.name === 'ModifiedTbody') {
                tbody = child;
                if (tbody?.props?.children) {
                    const tbodyChildren = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];
                    totalRows = tbodyChildren.filter((row: any) => row?.type?.name === 'ModifiedTr').length;
                }
            }
        });
        
        if (!tbody || totalRows <= 3) {
            return props.children;
        }
        
        // Limit tbody to first 3 rows
        const tbodyChildren = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];
        const visibleRows = tbodyChildren.filter((row: any) => row?.type?.name === 'ModifiedTr').slice(0, 3);
        const hiddenRowsCount = totalRows - 3;
        
        // Create modified tbody with limited rows
        const modifiedTbody = React.cloneElement(tbody, {
            children: [
                ...visibleRows,
                <tr key="more-rows-indicator" style={{ borderBottom: 'none' }}>
                    <td colSpan={100} style={{ 
                        padding: '2px', 
                        textAlign: 'left', 
                        fontSize: '0.8em', 
                        color: '#718096',
                    }}>
                        +{hiddenRowsCount} more {hiddenRowsCount === 1 ? 'row' : 'rows'}
                    </td>
                </tr>
            ]
        });
        
        return [thead, modifiedTbody].filter(Boolean);
    };

    // Calculate rows for modal display limiting (10 rows)
    const getModalTableChildren = () => {
        if (!props.children || isEmpty) return props.children;
        
        const children = Array.isArray(props.children) ? props.children : [props.children];
        let thead: any = null;
        let tbody: any = null;
        let totalRows = 0;
        
        // Find thead and tbody
        children.forEach((child: any) => {
            if (child?.type?.name === 'ModifiedThead') {
                thead = child;
            } else if (child?.type?.name === 'ModifiedTbody') {
                tbody = child;
                if (tbody?.props?.children) {
                    const tbodyChildren = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];
                    totalRows = tbodyChildren.filter((row: any) => row?.type?.name === 'ModifiedTr').length;
                }
            }
        });
        
        if (!tbody || totalRows <= 10) {
            return props.children;
        }
        
        // Limit tbody to first 10 rows
        const tbodyChildren = Array.isArray(tbody.props.children) ? tbody.props.children : [tbody.props.children];
        const visibleRows = tbodyChildren.filter((row: any) => row?.type?.name === 'ModifiedTr').slice(0, 10);
        const hiddenRowsCount = totalRows - 10;
        
        // Create modified tbody with limited rows
        const modifiedTbody = React.cloneElement(tbody, {
            children: [
                ...visibleRows,
                <tr key="more-rows-indicator-modal" style={{ borderBottom: 'none' }}>
                    <td colSpan={100} style={{ 
                        padding: '8px 16px', 
                        textAlign: 'left', 
                        fontSize: '0.8em', 
                        color: '#718096',
                        fontStyle: 'italic'
                    }}>
                        +{hiddenRowsCount} more {hiddenRowsCount === 1 ? 'row' : 'rows'}
                    </td>
                </tr>
            ]
        });
        
        return [thead, modifiedTbody].filter(Boolean);
    };

    return (
        <>
            <Box position="relative">
                <HStack justifyContent="space-between" alignItems="center" mb={2}>
                    <h4 style={{ marginTop: '3px', fontWeight: '600', color: '#2d3748' }}>
                        Results: 
                    </h4>
                    <Tooltip label="Expand Results" openDelay={300}>
                        <IconButton
                            icon={<Icon as={BiExpand} />}
                            size="xs"
                            variant="ghost"
                            color="minusxBW.600"
                            aria-label="Expand Results"
                            onClick={handleModalOpen}
                            isDisabled={isEmpty && !isStarting}
                        />
                    </Tooltip>
                </HStack>
                <div style={{
                    // maxHeight: '200px',
                    overflowY: 'auto',
                    overflowX: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '6px',
                    margin: '10px 0'
                }}>
                    <table style={{
                        width: '100%',
                        minWidth: 'max-content',
                        borderCollapse: 'collapse',
                        fontSize: '0.9em'
                    }}>
                        {getProcessedTableChildren()}
                    </table>
                </div>
            </Box>

            {/* Modal View */}
            <Modal isOpen={isModalOpen} onClose={handleModalClose} size="6xl" scrollBehavior="inside">
                <ModalOverlay bg="blackAlpha.700" />
                <ModalContent maxW="90vw" h="90vh" bg="minusxBW.200">
                    <ModalHeader pb={2} pt={4} px={4}>
                        <HStack justifyContent="space-between">
                            <HStack>
                                <span style={{fontSize: '1.125rem', fontWeight: 600, color: '#2d3748'}}>Results</span>
                            </HStack>
                        </HStack>
                    </ModalHeader>
                    <ModalCloseButton top={4} right={4}/>
                    <ModalBody p={4} sx={{
                        '&::-webkit-scrollbar': { width: '10px' },
                        '&::-webkit-scrollbar-track': { background: 'minusxBW.300', borderRadius: '5px' },
                        '&::-webkit-scrollbar-thumb': { background: 'minusxBW.500', borderRadius: '5px' },
                        '&::-webkit-scrollbar-thumb:hover': { background: 'minusxBW.600' },
                    }}>
                        <div style={{
                            overflowY: 'auto',
                            overflowX: 'auto',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            backgroundColor: 'white'
                        }}>
                            <table style={{
                                width: '100%',
                                minWidth: 'max-content',
                                borderCollapse: 'collapse',
                                fontSize: '0.9em'
                            }}>
                                {getModalTableChildren()}
                            </table>
                        </div>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    )
}

function ModifiedThead(props: any) {
    return (
        <thead style={{
            backgroundColor: '#f7fafc',
            position: 'sticky',
            top: 0,
            zIndex: 1
        }}>
            {props.children}
        </thead>
    )
}

function ModifiedTbody(props: any) {
    return (
        <tbody>
            {props.children}
        </tbody>
    )
}

function ModifiedTr(props: any) {
    return (
        <tr style={{
            borderBottom: '1px solid #e2e8f0'
        }}>
            {props.children}
        </tr>
    )
}

function ModifiedTh(props: any) {
    return (
        <th style={{
            padding: '12px 16px',
            textAlign: 'left',
            fontWeight: '600',
            color: '#2d3748',
            borderBottom: '2px solid #e2e8f0'
        }}>
            {props.children}
        </th>
    )
}

function ModifiedTd(props: any) {
    return (
        <td style={{
            padding: '12px 16px',
            color: '#4a5568',
            wordBreak: 'break-word'
        }}>
            {props.children}
        </td>
    )
}

function ZoomableImage({src, alt}: {src: string, alt: string}) {
  return <div style={{cursor: "grabbing"}}>
    <TransformWrapper initialScale={1} doubleClick={{disabled: true}}>
      <TransformComponent>
        <Image src={src} alt={alt}/>
      </TransformComponent>
    </TransformWrapper>
  </div>
}

function ImageComponent(props: any) {
  if (!props) {
    return null
  }
  return <ZoomableImage src={props.src} alt={props.alt}/>
}

function generateMetabaseQuestionURL(query: any, queryType: string, databaseId: number | null = null, embedConfigs: EmbedConfigs = {}) {
  // Get Metabase origin from embed_configs if available, otherwise use iframe info
    const isEmbedded = getParsedIframeInfo().isEmbedded as unknown === 'true'
    let cardData: any = {};
    if (queryType === 'sql') {
        const templateTags = getAllTemplateTagsInQuery(query);
        // Get all template tags in the query (we don't have access to snippets here, so pass undefined)
        cardData = {
            "dataset_query": {
            "database": databaseId,
            "type": "native",
            "native": {
                "query": query,
                "template-tags": templateTags
            }
            },
            "display": "table",
            "parameters": [],
            "visualization_settings": {},
            "type": "question"
        };
        
    }
    else if (queryType === 'mbql') {
           cardData = {
            "dataset_query": {
            "database": databaseId,
            "type": "query",
            "query": query,
            },
            "display": "table",
            "visualization_settings": {},
            "type": "question"
        };     
    }
  
  const hash = btoa(JSON.stringify(cardData));
  const origin = embedConfigs.embed_host;
  if (!origin || !isEmbedded) {
     return `${getOrigin()}/question#${hash}`;
  }
  return `${origin}/question?hash=${encodeURIComponent(hash)}`;
}

interface LastQuery {
    query: string;
    queryType: 'sql' | 'mbql';
}

function extractLastQueryFromMessages(messages: any[], currentMessageIndex: number, toolContext: any): LastQuery | null {
  // Look backwards from the message before the current one
  for (let i = currentMessageIndex - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role === 'assistant' && message.content?.toolCalls) {
      // Check tool calls in assistant messages
      for (let j = message.content.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = message.content.toolCalls[j];
        if (toolCall.function?.name === 'ExecuteQuery' ||
            toolCall.function?.name === 'ExecuteQueryV2' ||
            toolCall.function?.name === 'updateSQLQuery' || 
            toolCall.function?.name === 'runSQLQuery') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            if (args.sql) {
              return {query: args.sql, queryType: 'sql'};
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
        else if (toolCall.function?.name === 'ExecuteMBQLQuery' ||
                 toolCall.function?.name === 'ExecuteMBQLQueryV2' ||
                 toolCall.function?.name === 'runMBQLQuery') {
          // Handle MBQL queries
            try {
            const args = JSON.parse(toolCall.function.arguments);
            if (args.mbql) {
                // Return the MBQL query directly
                return {query: args.mbql, queryType: 'mbql'};
            }
            } catch (e) {
                // Ignore parsing errors
            }
        }
      }
    } else if (message.role === 'user') {
      break
    }
  }
  return null;
}

const useAppStore = getApp().useStore();

// Component to detect @ mentions in text and render with colors
function MentionAwareText({ children }: { children: React.ReactNode }) {
  const toolContext: MetabaseContext = useAppStore((state) => state.toolContext)
  
  // Create mention items for determining colors
  const mentionItems = useMemo(() => {
    if (!toolContext?.dbInfo) return []
    const tables = toolContext.dbInfo.tables || []
    const models = toolContext.dbInfo.models || []
    return createMentionItems(tables, models)
  }, [toolContext?.dbInfo])

  // Create lookup map for determining mention types
  const mentionMap = useMemo(() => {
    const map = new Map<string, 'table' | 'model'>()
    mentionItems.forEach((item: MentionItem) => {
      map.set(item.name.toLowerCase(), item.type)
    })
    return map
  }, [mentionItems])

  // Only process string children
  if (typeof children !== 'string') {
    return <>{children}</>
  }

  const renderTextWithColors = (text: string) => {
    // Regex to find @ mentions (@ followed by word characters)
    const mentionRegex = /@(\w+)/g
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0
    let match

    while ((match = mentionRegex.exec(text)) !== null) {
      // Add text before the mention
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index))
      }

      const mentionName = match[1]
      const mentionType = mentionMap.get(mentionName.toLowerCase())
      
      if (mentionType) {
        // Render as colored mention
        const color = mentionType === 'table' ? '#3182ce' : '#805ad5' // Blue for tables, purple for models
        parts.push(
          <span
            key={`mention-${match.index}`}
            style={{ color, fontWeight: 500 }}
          >
            @{mentionName}
          </span>
        )
      } else {
        // Check if it looks like a missing reference pattern @[type:id]
        if (text.slice(match.index).match(/^@\[[^:]+:\w+\]/)) {
          parts.push(
            <span
              key={`mention-missing-${match.index}`}
              style={{ color: '#718096' }}
            >
              {match[0]}
            </span>
          )
        } else {
          // Regular @ mention, not in our database
          parts.push(match[0])
        }
      }

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    return parts.length > 1 ? <>{parts}</> : text
  }

  return <>{renderTextWithColors(children)}</>
}

export function Markdown({content, messageIndex}: {content: string, messageIndex?: number}) {
  const currentThread = useSelector((state: RootState) => 
    state.chat.threads[state.chat.activeThread]
  );
  
  const toolContext = useAppStore((state) => state.toolContext);
  
  // Get settings and cache for dependencies
  const settings = useSelector((state: RootState) => ({
    modelsMode: state.settings.modelsMode
  }));
  const embedConfigs = useSelector((state: RootState) => state.configs.embed);
  const mxModels = useSelector((state: RootState) => state.cache.mxModels);
  
  // Process template variables like {{MX_LAST_QUERY_URL}}
  // Create mention items from toolContext
  const mentionItems = useMemo(() => {
    if (!toolContext?.dbInfo) return []
    const tables = toolContext.dbInfo.tables || []
    const models = toolContext.dbInfo.models || []
    return createMentionItems(tables, models)
  }, [toolContext?.dbInfo])

  const processedContent = React.useMemo(() => {
    if (content.includes('{{MX_LAST_QUERY_URL}}')) {
      try {
        // Extract last SQL from messages before the current message
        let lastQuery = messageIndex !== undefined 
          ? extractLastQueryFromMessages(currentThread?.messages || [], messageIndex, toolContext)
          : null;
        if (lastQuery) {
          // Get current database ID from app state
          const databaseId = toolContext?.dbId || null;

          const questionURL = generateMetabaseQuestionURL(lastQuery.query, lastQuery.queryType, databaseId, embedConfigs);

          return renderString(content, {
            'MX_LAST_QUERY_URL': `\n\n --- \n\n Continue your analysis [here](${questionURL})`
          });
        } 
        else {
            return content.replace('{{MX_LAST_QUERY_URL}}', ''); // Remove if no SQL found
        }
      } catch (error) {
        console.warn('Failed to generate MX_LAST_QUERY_URL:', error);
      }
    }
    
    return content;
  }, [content, currentThread?.messages, toolContext?.dbId, messageIndex, settings, mxModels]);

  // Create a wrapped ModifiedCode component that has access to mentionItems
  const ModifiedCodeWithMentions = (props: any) => (
    <ModifiedCode {...props} mentionItems={mentionItems} />
  )

  return (
    <MarkdownComponent 
      remarkPlugins={[remarkGfm]} 
      className={"markdown"} 
      components={{ 
        a: LinkRenderer, 
        p: ModifiedParagraph, 
        ul: ModifiedUL, 
        ol: ModifiedOL, 
        img: ImageComponent, 
        pre: ModifiedPre, 
        blockquote: ModifiedBlockquote, 
        code: ModifiedCodeWithMentions, 
        hr: HorizontalLine, 
        h1: ModifiedH1, 
        h2: ModifiedH2, 
        h3: ModifiedH3, 
        h4: ModifiedH4, 
        table: ModifiedTable, 
        thead: ModifiedThead, 
        tbody: ModifiedTbody, 
        tr: ModifiedTr, 
        th: ModifiedTh, 
        td: ModifiedTd,
      }}
    >
      {processedContent}
    </MarkdownComponent>
  )
}