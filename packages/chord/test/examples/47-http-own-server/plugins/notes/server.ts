// The notes plugin's server facet: one route, the same whichever server runs it.

import { defineFacet } from "@nycode/chord";
import { Http } from "@nycode/chord/http";

export default defineFacet((_host, self) =>
	self.contribute(Http, {
		routes: {
			"GET /notes": {
				public: true,
				handler: async (request) => ({ kind: "json", value: { notes: ["buy milk"], via: request.origin } }),
			},
		},
	}),
);
