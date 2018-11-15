#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2014, Joyent, Inc.
#

#
# Files
#
DOC_FILES =		index.md

JS_FILES := \
			cmd/get_usage.js \
			cmd/hagfish-watcher.js \
			lib/common.js \
			lib/gzip.js \
			lib/service_gzip.js \
			lib/service_usage.js \
			lib/service.js \
			lib/ufw.js \
			lib/usage.js

JSL_CONF_NODE =		tools/jsl.node.conf
JSL_FILES_NODE =	$(JS_FILES)
JSSTYLE_FILES =		$(JS_FILES)
JSSTYLE_FLAGS =		-o indent=4,doxygen,unparenthesized-return=0
SMF_MANIFESTS_IN =	smf/manifests/hagfish-watcher.xml.in

#
# Use a build of node compiled on the oldest supported SDC 6.5 platform:
#
MANTA_BASE =		http://us-east.manta.joyent.com
NODE_VERSION =		v0.10.26
NODE_BASE_URL =		$(MANTA_BASE)/Joyent_Dev/public/old_node_builds
NODE_TARBALL =		node-$(NODE_VERSION)-sdc65.tar.gz

NODE_EXEC =		$(TOP)/build/node/bin/node
NPM_EXEC =		$(NODE_EXEC) $(TOP)/build/node/bin/npm \
			--unsafe-perm false

CLEAN_FILES += \
			node \
			node_modules \
			downloads

include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.smf.defs

NAME :=			hagfish-watcher
RELEASE_TARBALL :=	$(NAME)-$(STAMP).tgz
RELEASE_MANIFEST :=	$(NAME)-$(STAMP).manifest
RELSTAGEDIR :=		/tmp/$(STAMP)

#
# Repo-specific targets
#
.PHONY: all
all: $(SMF_MANIFESTS) | $(NODE_EXEC) $(REPO_DEPS)
	$(NPM_EXEC) install

$(TOP)/downloads/$(NODE_TARBALL):
	@echo "downloading node $(NODE_VERSION) ..."
	mkdir -p $(TOP)/downloads
	curl -f -kL -o $@ '$(NODE_BASE_URL)/$(NODE_TARBALL)'
	touch $@

$(NODE_EXEC): $(TOP)/downloads/$(NODE_TARBALL)
	@echo "extracting node $(NODE_VERSION) ..."
	mkdir -p $(TOP)/build/node
	gtar -xz -C $(TOP)/build/node -f downloads/$(NODE_TARBALL)
	touch $@

.PHONY: release
release: all deps docs $(SMF_MANIFESTS)
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/$(NAME)
	cd $(TOP) && $(NPM_EXEC) install
	cp -r \
	$(TOP)/Makefile \
	$(TOP)/bin \
	$(TOP)/build \
	$(TOP)/cmd \
	$(TOP)/config \
	$(TOP)/lib \
	$(TOP)/node_modules \
	$(TOP)/npm \
	$(TOP)/package.json \
	$(TOP)/smf \
	$(RELSTAGEDIR)/hagfish-watcher
	uuid -v4 > $(RELSTAGEDIR)/hagfish-watcher/image_uuid
	json -f $(TOP)/package.json -e 'this.version += "-$(STAMP)"' \
	    > $(RELSTAGEDIR)/hagfish-watcher/package.json
	(cd $(RELSTAGEDIR) && $(TAR) -zcf $(TOP)/$(RELEASE_TARBALL) *)
	cat $(TOP)/manifest.tmpl | sed \
		-e "s/UUID/$$(cat $(RELSTAGEDIR)/hagfish-watcher/image_uuid)/" \
		-e "s/NAME/$$(json name < $(TOP)/package.json)/" \
		-e "s/VERSION/$$(json version < $(TOP)/package.json)/" \
		-e "s/DESCRIPTION/$$(json description < $(TOP)/package.json)/" \
		-e "s/BUILDSTAMP/$(STAMP)/" \
		-e "s/SIZE/$$(stat --printf="%s" $(TOP)/$(RELEASE_TARBALL))/" \
		-e "s/SHA/$$(openssl sha1 $(TOP)/$(RELEASE_TARBALL) \
		    | cut -d ' ' -f2)/" \
		> $(TOP)/$(RELEASE_MANIFEST)
	@rm -rf $(RELSTAGEDIR)

.PHONY: publish
publish: release
	@if [[ -z "$(BITS_DIR)" ]]; then \
		@echo "error: 'BITS_DIR' must be set for 'publish' target"; \
		exit 1; \
	fi
	mkdir -p $(BITS_DIR)/$(NAME)
	cp $(TOP)/$(RELEASE_TARBALL) $(BITS_DIR)/$(NAME)/$(RELEASE_TARBALL)
	cp $(TOP)/$(RELEASE_MANIFEST) $(BITS_DIR)/$(NAME)/$(RELEASE_MANIFEST)

.PHONY: dumpvar
dumpvar:
	@if [[ -z "$(VAR)" ]]; then \
		echo "error: set 'VAR' to dump a var"; \
		exit 1; \
	fi
	@echo "$(VAR) is '$($(VAR))'"

include ./tools/mk/Makefile.deps
include ./tools/mk/Makefile.smf.targ
include ./tools/mk/Makefile.targ
