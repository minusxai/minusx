import type * as React from 'react';

import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from './components/card';
import { Badge } from './components/badge';
import { Button } from './components/button';
import { Alert, AlertTitle, AlertDescription } from './components/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from './components/table';
import { Separator } from './components/separator';
import { Skeleton } from './components/skeleton';
import { Progress } from './components/progress';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from './components/breadcrumb';
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
} from './components/avatar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './components/tabs';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from './components/accordion';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from './components/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from './components/tooltip';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from './components/popover';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const STORY_UI_COMPONENTS: Record<string, React.ComponentType<any>> = {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
  Badge,
  Button,
  Alert,
  AlertTitle,
  AlertDescription,
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
  Separator,
  Skeleton,
  Progress,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarBadge,
  AvatarGroup,
  AvatarGroupCount,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
};

export const STORY_UI_COMPONENT_NAMES = Object.keys(STORY_UI_COMPONENTS);
