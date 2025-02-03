import React, { useState } from "react";
import { Box, Table, Thead, Tbody, Tr, Th, Td, Checkbox, Input, Divider } from "@chakra-ui/react";
import { FormattedTable } from 'apps/types';



export const FilteredTable = ({ data, selectedData, searchKey, displayKeys, addFn, removeFn }: {data: FormattedTable[], selectedData: FormattedTable[], searchKey: string, displayKeys: string[], addFn:any, removeFn:any}) => {
    const [search, setSearch] = useState("");
    
    const handleAdd = (item: FormattedTable) => {
        addFn(item.name);
    };

    const handleRemove = (item: FormattedTable) => {
        removeFn(item.name);
    }

    const displayRows = data.filter((item) => {
        if (search.length === 0) {
            return true;
        }
        return item[searchKey].toLowerCase().includes(search.toLowerCase());
    }).sort((a, b) => selectedData.some((n) => n.name === a.name) ? -1 : 1);

    return (
    <Box>
        <Box position="relative" width="100%" mb={4} mt={4} p={1}>
            <Input
                placeholder={`Search table name (${data.length} tables)`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                borderColor={"minusxGreen.600"}
            />

        </Box>
        <Box  maxHeight={"375px"} overflow={"scroll"}>
        <Table variant="striped" size="md">
        <Thead>
            <Tr>
                <Th>Selected</Th>
                {displayKeys.map((key) => (
                    <Th key={key}>{key}</Th>
                ))}
            </Tr>
        </Thead>
        <Tbody>
            {displayRows.map((item) => (
            <Tr key={item.name}>
                <Td>
                <Checkbox
                    isChecked={selectedData.some((n) => n.name === item.name)}
                    onChange={(e) => {
                        if (e.target.checked) {
                            handleAdd(item);
                        } else {
                            handleRemove(item);
                        }
                    }}
                />
                </Td>
                {displayKeys.map((key) => (
                    <Td key={key}>{item[key]}</Td>
                ))}
            </Tr>
            ))}
        </Tbody>
        </Table>
        </Box>
        <Divider/>
    </Box>
  );
}
