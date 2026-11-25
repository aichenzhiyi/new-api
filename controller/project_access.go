package controller

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetProject(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	project, err := model.GetProjectForUser(c.GetInt("id"), id)
	if err != nil {
		if errors.Is(err, model.ErrProjectAccessDenied) {
			writeProjectAccessDenied(c, id)
			return
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, project)
}

func writeProjectAccessDenied(c *gin.Context, projectId int) {
	c.JSON(http.StatusForbidden, gin.H{"success": false, "message": model.ErrProjectAccessDenied.Error()})
	recordUserSecurityAudit(c, c.GetInt("id"), "project.access.denied", map[string]any{"id": projectId, "success": false})
}

func GetProjectDepartments(c *gin.Context) {
	departments, err := model.GetProjectDepartmentsForUser(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, departments)
}

func GetUserOrganization(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	assignment, err := model.GetUserOrganization(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, assignment)
}

func UpdateUserOrganization(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var input model.UserOrganizationAssignment
	if err := common.DecodeJson(c.Request.Body, &input); err != nil || input.ProjectIds == nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	proof := requireAdminUserProof(c, service.VerificationScopeAdminUserUpdate, service.AdminUserContext{UserID: id})
	if proof == nil {
		return
	}
	before, err := model.SaveUserOrganization(c.GetInt("id"), id, &input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAuditFor(c, id, "user.organization.update", map[string]any{"id": id, "before": before, "after": input, "verification_method": proof.Method})
	common.ApiSuccess(c, input)
}
