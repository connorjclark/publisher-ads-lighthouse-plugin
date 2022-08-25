// Copyright 2019 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import * as i18n from 'lighthouse/core/lib/i18n/i18n.js';

import NetworkRecords from 'lighthouse/core/computed/network-records.js';

// @ts-ignore
import {auditNotApplicable} from '../messages/common-strings.js';

import {Audit} from 'lighthouse';
import {getTimingsByRecord} from '../utils/network-timing.js';
import {isAdTag} from '../utils/resource-classification.js';

const UIStrings = {
  title: 'Minimal render-blocking resources found',
  failureTitle: 'Avoid render-blocking resources',
  description: 'Render-blocking resources slow down tag load times. Consider ' +
  'loading critical JS/CSS inline or loading scripts asynchronously or ' +
  'loading the tag earlier in the head. [Learn more](' +
  'https://developers.google.com/web/tools/lighthouse/audits/blocking-resources' +
  ').',
  failureDisplayValue: 'Up to {timeInMs, number, seconds} s tag load time ' +
  'improvement',
  columnUrl: 'Resource',
  columnStartTime: 'Start',
  columnDuration: 'Duration',
};

/** @typedef {LH.Artifacts.NetworkRequest} NetworkRequest */
/** @typedef {LH.Gatherer.Simulation.NodeTiming} NodeTiming */

const str_ = i18n.createIcuMessageFn(import.meta.url, UIStrings);

const THRESHOLD_MS = 100;

/**
 * Table headings for audits details sections.
 * @type {LH.Audit.Details.Table['headings']}
 */
const HEADINGS = [
  {
    key: 'url',
    itemType: 'url',
    text: str_(UIStrings.columnUrl),
  },
  {
    key: 'startTime',
    itemType: 'ms',
    text: str_(UIStrings.columnStartTime),
    granularity: 1,
  },
  {
    key: 'duration',
    itemType: 'ms',
    text: str_(UIStrings.columnDuration),
    granularity: 1,
  },
];

/** Audits for render blocking resources */
class AdRenderBlockingResources extends Audit {
  /**
   * @return {LH.Audit.Meta}
   */
  static get meta() {
    return {
      id: 'ad-render-blocking-resources',
      title: str_(UIStrings.title),
      failureTitle: str_(UIStrings.failureTitle),
      scoreDisplayMode: 'binary',
      description: str_(UIStrings.description),
      requiredArtifacts:
          ['TagsBlockingFirstPaint', 'devtoolsLogs', 'traces'],
    };
  }

  /**
   * @param {LH.Artifacts} artifacts
   * @param {LH.Audit.Context} context
   * @return {Promise<LH.Audit.Product>}
   */
  static async audit(artifacts, context) {
    const devtoolsLog = artifacts.devtoolsLogs[Audit.DEFAULT_PASS];
    const trace = artifacts.traces[Audit.DEFAULT_PASS];
    const networkRecords = await NetworkRecords.request(devtoolsLog, context);
    const tag = networkRecords.find((req) => isAdTag(new URL(req.url)));
    if (!tag) {
      return auditNotApplicable.NoTag;
    }

    /** @type {Map<NetworkRequest, NodeTiming>} */
    const timingsByRecord =
      await getTimingsByRecord(trace, devtoolsLog, context);

    // NOTE(warrengm): Ideally we would key be requestId here but
    // TagsBlockingFirstPaint doesn't have request IDs.
    /** @type {Set<string>} */
    const blockingElementUrls = new Set();
    for (const blockingTag of artifacts.TagsBlockingFirstPaint) {
      blockingElementUrls.add(blockingTag.tag.url);
    }

    // NOTE(cjamcl): Ideally this would filter the TagsBlockingFirstPaint
    // artifact because it has a more accurate endTime for stylesheets
    // that are only considered blocking due to changes in media styles during
    // the load of the page. But I'm not certain that dropping the initiator
    // checks below will be equivalent (it may be, I just haven't reasoned
    // about it fully).
    const blockingNetworkRecords = networkRecords
        // Don't fail on sync resources loaded after the tag. This includes sync
        // resources loaded inside of iframes.
        .filter((r) => r.endTime < tag.startTime)
        .filter((r) => r != tag.initiatorRequest)
        // Sanity check to filter out duplicate requests which were async. If
        // type != parser then the resource was dynamically added and is
        // therefore async (non-blocking).
        .filter((r) => r.initiator.type === 'parser')
        .filter((r) => blockingElementUrls.has(r.url));

    const tableView = blockingNetworkRecords
        .map((r) => Object.assign({url: r.url}, timingsByRecord.get(r)));

    tableView.sort((a, b) => a.endTime - b.endTime);

    const tagTime = timingsByRecord.get(tag) || {startTime: Infinity};
    // @ts-ignore
    const startTimes = tableView.map((r) => r.startTime);
    // @ts-ignore
    const endTimes = tableView.map((r) => r.endTime);

    const blockingStart = Math.min(...startTimes);
    const blockingEnd = Math.min(Math.max(...endTimes), tagTime.startTime);
    const opportunity = blockingEnd - blockingStart;
    let displayValue = '';
    if (tableView.length > 0 && opportunity > 0) {
      displayValue = str_(
        UIStrings.failureDisplayValue, {timeInMs: opportunity});
    }

    const failed = tableView.length > 0 && opportunity > THRESHOLD_MS;
    return {
      score: failed ? 0 : 1,
      numericValue: tableView.length,
      numericUnit: 'unitless',
      displayValue,
      details: {
        opportunity,
        ...AdRenderBlockingResources.makeTableDetails(HEADINGS, tableView),
      },
    };
  }
}

export default AdRenderBlockingResources;
export {UIStrings};
