import React, { useMemo } from 'react';
import {
  Box,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import {
    BiSolidCheckCircle,
    BiSolidErrorCircle,
} from 'react-icons/bi';
import { BiCircle } from 'react-icons/bi';
import { useSelector } from 'react-redux';
import { RootState } from '../../state/store';
import { Task, Tasks as TasksInfo } from '../../state/chat/reducer';
import { get, last } from 'lodash';
import { getActionTaskLiteLabels } from '../../helpers/utils';

interface TaskWithLevel extends Task {
  level: number;
}

interface TimelineNodeProps {
  task: TaskWithLevel;
  isLast: boolean;
  parentLevels: boolean[];
}

const TimelineNode: React.FC<TimelineNodeProps> = ({
    task,
    isLast,
    parentLevels
}) => {
  const getStatusIcon = () => {
    if (task.result != null) {
        const isError = (typeof task.result === 'object' && task.result !== null && (task.result as any).error);
        if (isError) {
            return <Icon as={BiSolidErrorCircle} color="red.500" title="Failed" />;
        }
        return <Icon as={BiSolidCheckCircle} color="green.500" title="Completed" />;
    } else {
        if ((task as any).status === 'running') {
             return <Spinner size="xs" speed="0.8s" thickness="2px" color="blue.500" title="Running" />;
        }
        return <Icon as={BiCircle} color="gray.500" title="Pending" />;
    }
  };

  const indentSize = 20;
  const level = task.level;

  return (
    <HStack
      spacing={0}
      w="100%"
      py={1}
      position="relative"
      alignItems="center"
    >
      {/* Tree structure lines */}
      {Array.from({ length: level }).map((_, i) => (
        <Box key={i} position="relative" width={`${indentSize}px`} height="20px">
          {/* Vertical line for parent levels */}
          {parentLevels[i] && (
            <Box
              position="absolute"
              left="9px"
              top="0"
              bottom="0"
              width="1px"
              bg="minusxBW.500"
            />
          )}
          
          {/* Connector lines for current level */}
          {i === level - 1 && (
            <>
              {/* Vertical line */}
              <Box
                position="absolute"
                left="9px"
                top="0"
                height={isLast ? "10px" : "100%"}
                width="1px"
                bg="minusxBW.500"
              />
              {/* Horizontal line */}
              <Box
                position="absolute"
                left="9px"
                top="9px"
                width="10px"
                height="1px"
                bg="minusxBW.500"
              />
            </>
          )}
        </Box>
      ))}
      
      {/* Status icon */}
      <Box flexShrink={0} display="flex" alignItems="center" w="20px" justifyContent="center" mr={2}>
        {getStatusIcon()}
      </Box>

      {/* Task name */}
      <Text fontSize="sm" fontWeight="500" noOfLines={1} flexGrow={1} title={task.agent}>
        {/* {task.agent} */}
        {getActionTaskLiteLabels(task.agent)}
      </Text>
    </HStack>
  );
};

interface FlattenedTask {
  task: TaskWithLevel;
  isLast: boolean;
  parentLevels: boolean[];
}

const flattenTasks = (tasks: TasksInfo): FlattenedTask[] => {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const result: FlattenedTask[] = [];
  
  const addTaskAndChildren = (task: Task, level: number = 0, parentLevels: boolean[] = [], isLastAtLevel: boolean = false) => {
    const taskWithLevel: TaskWithLevel = { ...task, level };
    
    result.push({
      task: taskWithLevel,
      isLast: isLastAtLevel,
      parentLevels: [...parentLevels]
    });
    
    if (Array.isArray(task.child_ids) && task.child_ids.length > 0) {
      const childTasks = task.child_ids
        .map(childId => taskMap.get(childId))
        .filter((child): child is Task => child !== undefined);
      
      const newParentLevels = [...parentLevels, !isLastAtLevel];
      
      childTasks.forEach((childTask, index) => {
        const isLastChild = index === childTasks.length - 1;
        addTaskAndChildren(childTask, level + 1, newParentLevels, isLastChild);
      });
    }
  };

  // Find root tasks (tasks without parents or whose parents don't exist)
  const childIds = new Set<string>();
  tasks.forEach(task => {
    if (Array.isArray(task.child_ids)) {
      task.child_ids.forEach(cid => childIds.add(cid));
    }
  });

  const rootTasks = tasks.filter(task =>
    !childIds.has(task.id) && (!task.parent_id || !taskMap.has(task.parent_id))
  );

  rootTasks.forEach((rootTask, index) => {
    const isLastRoot = index === rootTasks.length - 1;
    addTaskAndChildren(rootTask, 0, [], isLastRoot);
  });
  
  return result;
};

export const TasksLite: React.FC = () => {
  const thread = useSelector((state: RootState) => state.chat.activeThread);
  const activeThread = useSelector((state: RootState) => state.chat.threads[thread]);
  const taskInProgress = !(activeThread.status === 'FINISHED')
  const allTasks: TasksInfo = activeThread?.tasks || [];
  const flatTasks = useMemo(() => flattenTasks(allTasks), [allTasks]);
  
  const rootTasks = useMemo(() => {
    if (!allTasks || allTasks.length === 0) return [];
    const taskMap = new Map(allTasks.map(t => [t.id, t]));
    const childIds = new Set<string>();
    allTasks.forEach(task => {
        if (Array.isArray(task.child_ids)) {
            task.child_ids.forEach(cid => childIds.add(cid));
        }
    });
    return allTasks.filter(task =>
        !childIds.has(task.id) && (!task.parent_id || !taskMap.has(task.parent_id))
    );
  }, [allTasks]);
  
  const isEmpty = allTasks.length === 0;
  const isLoading = !isEmpty && rootTasks.length > 0 && !last(rootTasks)?.result;

  const lastMessage = last(activeThread?.messages);
  const lastMessageContent = get(lastMessage, 'content');
  const isStarting = (
      get(lastMessage, 'role') === 'user' ||
      (typeof lastMessageContent === 'string' && lastMessageContent.includes('/start_task'))
    ) && (isEmpty || isLoading);

  if (isStarting) {
    return (
      <Box
        bg={'minusxBW.300'}
        p={3}
        borderRadius={5}
        color={'minusxBW.600'}
        width={"100%"}
      >
        <VStack align="stretch" width={"100%"} spacing={2}>
          <HStack justifyContent="space-between" px={1}>
            <HStack>
              <Text fontSize={"sm"} fontWeight={600} color={'minusxBW.700'}>Tasks</Text>
              <Spinner size="xs" speed={'0.75s'} color="minusxBW.600" />
            </HStack>
          </HStack>
          <Text fontSize="sm" color="minusxBW.600" textAlign="center" p={2}>Loading tasks...</Text>
        </VStack>
      </Box>
    );
  }

  if (isEmpty) {
    return (
      <Box
        bg={'minusxBW.300'}
        p={3}
        borderRadius={5}
        color={'minusxBW.600'}
        width={"100%"}
      >
        <VStack align="stretch" width={"100%"} spacing={2}>
          <Text fontSize={"sm"} fontWeight={600} color={'minusxBW.700'}>Tasks</Text>
          <Text fontSize="sm" color="minusxBW.600" textAlign="center" p={2}>No tasks initiated.</Text>
        </VStack>
      </Box>
    );
  }

  return (
    <Box
      bg={'minusxBW.300'}
      p={3}
      borderRadius={5}
      color={'minusxBW.600'}
      width={"100%"}
      maxH="45vh"
      overflowY="auto"
      sx={{
        '&::-webkit-scrollbar': { width: '6px' },
        '&::-webkit-scrollbar-track': { background: 'minusxBW.400', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb': { background: 'minusxBW.500', borderRadius: '4px' },
        '&::-webkit-scrollbar-thumb:hover': { background: 'minusxBW.600' },
      }}
    >
      <VStack align="stretch" width={"100%"} spacing={2}>
        <HStack justifyContent="space-between" px={1}>
          <HStack>
            <Text fontSize={"sm"} fontWeight={600} color={'minusxBW.700'}>Tasks</Text>
            {isLoading && taskInProgress && <Spinner size="xs" speed={'0.75s'} color="minusxBW.600" />}
          </HStack>
        </HStack>

        <Box background={'minusxBW.200'} borderRadius={5} p={2}>
          <VStack align="stretch" spacing={0} w="100%">
            {flatTasks.map((flatTask, index) => (
              <TimelineNode
                key={`${flatTask.task.id}-${index}`}
                task={flatTask.task}
                isLast={flatTask.isLast}
                parentLevels={flatTask.parentLevels}
              />
            ))}
          </VStack>
        </Box>
      </VStack>
    </Box>
  );
};