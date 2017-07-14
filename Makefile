#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#

#
# Copyright (c) 2017, Joyent, Inc.
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

NODE_PREBUILT_VERSION =	v0.10.48
NODE_PREBUILT_TAG =	gz
NODE_PREBUILT_IMAGE =	fd2cc906-8938-11e3-beab-4359c665ac99

#
# Due to the unfortunate nature of NPM, the Node Package Manager, there appears
# to be no way to assemble our dependencies without running the lifecycle
# scripts.  These lifecycle scripts should not be run except in the context of
# an agent installation or uninstallation, so we provide a magic environment
# varible to disable them here.
#
NPM_ENV =		SDC_AGENT_SKIP_LIFECYCLE=yes

include ./tools/mk/Makefile.defs
include ./tools/mk/Makefile.smf.defs
include ./tools/mk/Makefile.node_prebuilt.defs
include ./tools/mk/Makefile.node_modules.defs

NAME :=			hagfish-watcher
RELEASE_TARBALL :=	$(NAME)-$(STAMP).tgz
RELEASE_MANIFEST :=	$(NAME)-$(STAMP).manifest
RELSTAGEDIR :=		/tmp/$(STAMP)

#
# Repo-specific targets
#
.PHONY: all
all: $(STAMP_NODE_MODULES) $(SMF_MANIFESTS)

.PHONY: release
release: all deps docs
	@echo "Building $(RELEASE_TARBALL)"
	@mkdir -p $(RELSTAGEDIR)/$(NAME)
	cp -r \
	    $(TOP)/bin \
	    $(TOP)/cmd \
	    $(TOP)/config \
	    $(TOP)/lib \
	    $(TOP)/node_modules \
	    $(TOP)/npm \
	    $(TOP)/package.json \
	    $(TOP)/smf \
	    $(RELSTAGEDIR)/$(NAME)
	mkdir -p $(RELSTAGEDIR)/$(NAME)/build/node/bin
	cp build/node/bin/node $(RELSTAGEDIR)/$(NAME)/build/node/bin/node
	uuid -v4 > $(RELSTAGEDIR)/$(NAME)/image_uuid
	json -f $(TOP)/package.json -e 'this.version += "-$(STAMP)"' \
	    > $(RELSTAGEDIR)/$(NAME)/package.json
	cd $(RELSTAGEDIR) && $(TAR) -zcf $(TOP)/$(RELEASE_TARBALL) *
	sed \
	    -e "s/UUID/$$(cat $(RELSTAGEDIR)/$(NAME)/image_uuid)/" \
	    -e "s/NAME/$$(json -f $(TOP)/package.json name)/" \
	    -e "s/VERSION/$$(json -f $(TOP)/package.json version)/" \
	    -e "s/DESCRIPTION/$$(json -f $(TOP)/package.json description)/" \
	    -e "s/BUILDSTAMP/$(STAMP)/" \
	    -e "s/SIZE/$$(stat --printf="%s" $(TOP)/$(RELEASE_TARBALL))/" \
	    -e "s/SHA/$$(openssl sha1 $(TOP)/$(RELEASE_TARBALL) \
	        | cut -d ' ' -f2)/" \
	    < $(TOP)/manifest.tmpl > $(TOP)/$(RELEASE_MANIFEST)
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
include ./tools/mk/Makefile.node_prebuilt.targ
include ./tools/mk/Makefile.node_modules.targ
