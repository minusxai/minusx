import type { IframeInfo } from 'extension/types';
import { configs } from '../constants';
import queryString from 'query-string';

export interface IframeInfoWeb extends IframeInfo {
    webGitCommitId: string
    webNpmVersion: string
}

export const defaultIframeInfoWeb: IframeInfoWeb = {
    tool: '',
    toolVersion: '',
    origin: '',
    mode: '',
    r: '',
    variant: 'default',
    width: '350',
    gitCommitId: '',
    npmPackageVersion: '',
    webGitCommitId: '',
    webNpmVersion: '',
    isEmbedded: false
}

const parsedIframeInfo: IframeInfo = (queryString.parse(location.search) as unknown as IframeInfo || defaultIframeInfoWeb)
const parsedWebIframeInfo: IframeInfoWeb = {
    ...defaultIframeInfoWeb,
    ...parsedIframeInfo,
    webGitCommitId: configs.GIT_COMMIT_ID,
    webNpmVersion: configs.NPM_PACKAGE_VERSION,
    isEmbedded: parsedIframeInfo.isEmbedded || false,
}

export const getParsedIframeInfo = (): IframeInfoWeb => {
    return parsedWebIframeInfo
}

export const getOrigin = () => {
    const parsed = getParsedIframeInfo()
    return parsed.origin
}