import { Inject, Injectable } from "@nestjs/common";

import type { VideoPolicyContext } from "../video-policy/video-policy.service.js";
import {
  ViewerPolicyContextService,
  type ViewerPolicyContext,
} from "../video-policy/viewer-policy-context.service.js";
import { SearchError } from "./search.service.js";

@Injectable()
export class SearchViewerContextService {
  constructor(
    @Inject(ViewerPolicyContextService) private readonly viewerContext: ViewerPolicyContextService,
  ) {}

  async run<T>(
    context: ViewerPolicyContext,
    operation: (policy: VideoPolicyContext) => Promise<T>,
  ): Promise<T> {
    return this.viewerContext.run(context, operation, viewerChanged);
  }
}

function viewerChanged(): SearchError {
  return new SearchError(
    "SEARCH_VIEWER_CHANGED",
    "Your viewer profile changed. Refresh and try again.",
    409,
  );
}
